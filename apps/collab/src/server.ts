// WICHTIG: env-Import zuerst — lädt .env bevor @dokunc/db o.ä. sie lesen.
import "./env";
import { Server } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { jwtVerify } from "jose";
import { Redis } from "ioredis";
import { Redis as HocuspocusRedis } from "@hocuspocus/extension-redis";
import pino from "pino";
import * as Y from "yjs";
import { prisma } from "@dokunc/db";
import {
  richExtensions,
  COLLAB_FIELD,
  extractWikiLinkIds,
  extractMentionIds,
  chunkText,
} from "@dokunc/editor";
import { startMailDispatcher } from "./mail-dispatcher";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "dokunc-collab" },
});

const PORT = Number(process.env.COLLAB_PORT ?? 3001);

function resolveAppSecret(): string {
  const s = process.env.APP_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!s || s.length < 32) {
      throw new Error(
        "APP_SECRET fehlt oder ist zu kurz (min. 32 Zeichen).",
      );
    }
    return s;
  }
  return s && s.length >= 32 ? s : "dev-only-insecure-secret-change-me-32+chars";
}

const SECRET = new TextEncoder().encode(resolveAppSecret());
const extensions = richExtensions();

/** Mindestabstand zwischen History-Snapshots pro Seite (ms). */
const VERSION_INTERVAL_MS = 2 * 60 * 1000;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});
redis.on("error", (e: Error) => log.warn({ err: e.message }, "redis"));

/**
 * Throttle für History-Snapshots — multi-instanz- und neustartfest.
 * Atomares SET NX PX: nur der erste Aufruf im Intervall darf einen
 * Snapshot schreiben; der Schlüssel verfällt automatisch.
 * Bei Redis-Ausfall wird zugunsten der History-Integrität erlaubt.
 */
async function shouldSnapshot(pageId: string): Promise<boolean> {
  try {
    const res = await redis.set(
      `dokunc:snapshot:${pageId}`,
      "1",
      "PX",
      VERSION_INTERVAL_MS,
      "NX",
    );
    return res === "OK";
  } catch {
    return true;
  }
}

async function authorize(token: string | undefined, pageId: string) {
  if (!token) throw new Error("Kein Token");
  const { payload } = await jwtVerify(token, SECRET);
  const userId = String(payload.sub);
  const tokenVersion = Number(payload.tv ?? 0);

  // Session-Revocation gilt auch für den WebSocket: Konto muss aktiv
  // sein und die Token-Version des JWT muss aktuell sein.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, tokenVersion: true },
  });
  if (!user || !user.isActive || user.tokenVersion !== tokenVersion) {
    throw new Error("Sitzung ungültig");
  }

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { spaceId: true, deletedAt: true },
  });
  if (!page || page.deletedAt) throw new Error("Seite nicht gefunden");

  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId: page.spaceId } },
    select: { role: true },
  });
  if (!member) throw new Error("Kein Zugriff auf diesen Space");

  const readOnly = member.role === "VIEWER";
  return { userId, readOnly };
}

// HA: mehrere Collab-Instanzen koordinieren Yjs-Dokumente + Awareness
// über Redis Pub/Sub (eine Instanz "ownt" ein Dokument, andere proxen).
const redisUrl = new URL(
  process.env.REDIS_URL ?? "redis://localhost:6379",
);
const haExtension = new HocuspocusRedis({
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
});

const server = new Server({
  port: PORT,
  extensions: [haExtension],
  async onAuthenticate(data) {
    const { userId, readOnly } = await authorize(
      data.token,
      data.documentName,
    );
    data.connectionConfig.readOnly = readOnly;
    return { userId };
  },

  async onLoadDocument(data) {
    const pageId = data.documentName;
    const existing = await prisma.collabDocument.findUnique({
      where: { pageId },
    });

    if (existing) {
      Y.applyUpdate(data.document, new Uint8Array(existing.state));
      return data.document;
    }

    // Erstes Öffnen: aus gespeichertem Page-Content seeden.
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true },
    });
    if (page?.content) {
      const seeded = TiptapTransformer.toYdoc(
        page.content,
        COLLAB_FIELD,
        extensions,
      );
      // Den frisch geseedeten Stand SOFORT festschreiben — aber nur,
      // wenn noch keiner da ist (upsert mit leerem update gewinnt den
      // Wettlauf atomar und liefert den Sieger zurück). Ohne das seeden
      // zwei gleichzeitig ladende Verbindungen (oder zwei Collab-
      // Instanzen) unabhängig voneinander, und Yjs führt beide Fassungen
      // zusammen: die Seite stünde doppelt im Dokument.
      const row = await prisma.collabDocument.upsert({
        where: { pageId },
        create: {
          pageId,
          state: Buffer.from(Y.encodeStateAsUpdate(seeded)),
        },
        update: {},
        select: { state: true },
      });
      Y.applyUpdate(data.document, new Uint8Array(row.state));
    }
    return data.document;
  },

  async onStoreDocument(data) {
    const pageId = data.documentName;
    const state = Buffer.from(Y.encodeStateAsUpdate(data.document));

    const json = TiptapTransformer.fromYdoc(data.document, COLLAB_FIELD);
    const textContent = extractText(json);
    const editorId =
      (data.lastContext?.userId as string | undefined) ?? undefined;

    // Alten Inhalt VOR dem Update lesen (für den Mention-Diff).
    const before = await prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true, spaceId: true, title: true },
    });

    await prisma.$transaction([
      prisma.collabDocument.upsert({
        where: { pageId },
        create: { pageId, state },
        update: { state },
      }),
      prisma.page.update({
        where: { id: pageId },
        data: {
          content: json,
          textContent,
          ...(editorId ? { lastEditedById: editorId } : {}),
        },
      }),
    ]);

    if (before) {
      await syncWikiLinks(pageId, before.spaceId, json).catch((e) =>
        log.warn({ err: String(e) }, "wikiLink sync fehlgeschlagen"),
      );
      await notifyNewMentions(
        pageId,
        before.spaceId,
        before.content,
        json,
        editorId,
      ).catch((e) =>
        log.warn({ err: String(e) }, "mention notify fehlgeschlagen"),
      );
      await indexChunks(pageId, textContent).catch((e) =>
        log.warn({ err: String(e) }, "chunk indexing fehlgeschlagen"),
      );
    }

    if (await shouldSnapshot(pageId)) {
      await prisma.pageVersion.create({
        data: {
          pageId,
          title: before?.title ?? "Untitled",
          content: json,
          textContent,
          authorId: editorId,
        },
      });
    }
  },
});

/**
 * Synchronisiert die PageLink-Tabelle (Backlinks) mit den Wiki-Links
 * im Dokument. Nur Ziele im selben Space (kein Cross-Space-Leak).
 */
async function syncWikiLinks(
  pageId: string,
  spaceId: string,
  json: unknown,
): Promise<void> {
  const targetIds = extractWikiLinkIds(json).filter((id) => id !== pageId);
  const valid = targetIds.length
    ? await prisma.page.findMany({
        where: { id: { in: targetIds }, spaceId },
        select: { id: true },
      })
    : [];
  const keep = new Set(valid.map((p) => p.id));

  await prisma.$transaction([
    prisma.pageLink.deleteMany({
      where: { sourcePageId: pageId, targetPageId: { notIn: [...keep] } },
    }),
    ...[...keep].map((targetPageId) =>
      prisma.pageLink.upsert({
        where: {
          sourcePageId_targetPageId: { sourcePageId: pageId, targetPageId },
        },
        create: { sourcePageId: pageId, targetPageId },
        update: {},
      }),
    ),
  ]);
}

/**
 * Erzeugt MENTION-Benachrichtigungen für Nutzer, die im Vergleich zum
 * vorherigen Stand NEU erwähnt wurden (und Mitglied des Space sind).
 */
async function notifyNewMentions(
  pageId: string,
  spaceId: string,
  oldContent: unknown,
  newContent: unknown,
  actorId: string | undefined,
): Promise<void> {
  const previous = new Set(extractMentionIds(oldContent));
  const added = extractMentionIds(newContent).filter(
    (id) => !previous.has(id) && id !== actorId,
  );
  if (added.length === 0) return;

  const members = await prisma.spaceMember.findMany({
    where: { spaceId, userId: { in: added } },
    select: { userId: true },
  });

  for (const { userId } of members) {
    const exists = await prisma.notification.findFirst({
      where: { userId, pageId, type: "MENTION", readAt: null },
      select: { id: true },
    });
    if (!exists) {
      await prisma.notification.create({
        data: { userId, actorId, type: "MENTION", pageId },
      });
    }
  }
}

/** Chunk-Größe für die KI-Indexierung (Zeichen). */
const CHUNK_SIZE = 1200;

/**
 * Zerlegt den Seitentext in Chunks und speichert sie für die KI-Suche.
 * Embeddings werden (falls konfiguriert) vom Retrieval-Layer der Web-App
 * nachgezogen — hier wird nur der Text aktuell gehalten.
 */
async function indexChunks(pageId: string, text: string): Promise<void> {
  const chunks = chunkText(text, CHUNK_SIZE);
  // Nur geänderte Chunks anfassen. Wer bei jedem Speichern ALLE
  // Embeddings verwirft, lässt nach jedem Tastendruck-Batch die ganze
  // Seite neu einbetten — kostenpflichtige API-Aufrufe für Text, der
  // sich gar nicht geändert hat, und bis dahin fehlt sie der Suche.
  const existing = await prisma.pageChunk.findMany({
    where: { pageId },
    select: { chunkIndex: true, text: true },
  });
  const before = new Map(existing.map((c) => [c.chunkIndex, c.text]));

  const writes = chunks
    .map((chunk, i) => ({ chunk, i }))
    .filter(({ chunk, i }) => before.get(i) !== chunk)
    .map(({ chunk, i }) =>
      prisma.pageChunk.upsert({
        where: { pageId_chunkIndex: { pageId, chunkIndex: i } },
        // embedding auf null: Text hat sich geändert -> neu einbetten.
        create: { pageId, chunkIndex: i, text: chunk },
        update: { text: chunk, embedding: null },
      }),
    );

  const stale = existing.some((c) => c.chunkIndex >= chunks.length);
  if (writes.length === 0 && !stale) return;

  await prisma.$transaction([
    prisma.pageChunk.deleteMany({
      where: { pageId, chunkIndex: { gte: chunks.length } },
    }),
    ...writes,
  ]);
}

/** Plain-Text aus ProseMirror-JSON ziehen (für Suche/History). */
function extractText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return n.content.map(extractText).join(" ");
  }
  return "";
}

/**
 * Kanal, über den die Web-App bittet, ein Dokument neu aus der Datenbank
 * aufzubauen (Wiederherstellen einer Version). Muss zu
 * apps/web/src/lib/collab-sync.ts passen.
 */
const DOC_RESET_CHANNEL = "dokunc:doc-reset";
/** Muss zu apps/web/src/lib/collab-sync.ts passen. */
const ACCESS_REVOKED_CHANNEL = "dokunc:access-revoked";

/**
 * Ersetzt den Inhalt eines Yjs-Dokuments durch den gespeicherten
 * `Page.content`.
 *
 * Ohne das bliebe ein geöffnetes Dokument im Speicher unverändert: die
 * Web-App schreibt beim Wiederherstellen nur `Page.content`, der nächste
 * `onStoreDocument` schriebe den alten Speicherstand zurück — die
 * Wiederherstellung wäre still verpufft. Über eine Direktverbindung
 * gesetzt, ziehen offene Editoren den Stand sofort nach.
 */
async function resetDocument(pageId: string): Promise<boolean> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { content: true, deletedAt: true },
  });
  if (!page || page.deletedAt || !page.content) return false;

  const seeded = TiptapTransformer.toYdoc(
    page.content,
    COLLAB_FIELD,
    extensions,
  );
  // Yjs-Typen gehören zu genau einem Dokument — für das Ziel geklont.
  // XmlHook kommt im Editor-Schema nicht vor und wird übersprungen.
  const nodes = seeded
    .getXmlFragment(COLLAB_FIELD)
    .toArray()
    .filter(
      (node): node is Y.XmlElement | Y.XmlText =>
        node instanceof Y.XmlElement || node instanceof Y.XmlText,
    )
    .map((node) => node.clone());

  // `server.hocuspocus` ist die Instanz mit den Dokumenten; `server` ist
  // nur der HTTP-/WebSocket-Aufsatz darum.
  const connection = await server.hocuspocus.openDirectConnection(pageId);
  try {
    await connection.transact((doc: Y.Doc) => {
      const fragment = doc.getXmlFragment(COLLAB_FIELD);
      fragment.delete(0, fragment.length);
      fragment.insert(0, nodes);
    });
  } finally {
    await connection.disconnect();
  }
  return true;
}

/**
 * Auf Reset-Wünsche der Web-App hören. Der Nonce-Lock stellt sicher, dass
 * bei mehreren Instanzen GENAU EINE das Dokument ersetzt — sonst fügten
 * zwei Instanzen ihre Kopie ein und der Inhalt stünde doppelt da.
 */
/**
 * Alle offenen Verbindungen einer Person in einem Space trennen. Die
 * Zugriffspruefung laeuft nur beim Verbinden (`onAuthenticate`) — ohne
 * dieses Trennen behaelt jemand nach dem Entzug der Mitgliedschaft (oder
 * nach der Herabstufung auf VIEWER) sein Schreibrecht, bis er die Seite
 * neu laedt. Beim naechsten Verbinden greift die Pruefung wieder.
 */
async function disconnectUserFromSpace(
  userId: string,
  spaceId: string,
): Promise<number> {
  // Erst die offenen Dokumente sammeln, in denen diese Person haengt …
  type Closable = {
    context: unknown;
    close: () => void;
    webSocket: { close: (code?: number, reason?: string) => void };
  };
  const candidates = new Map<string, Closable[]>();
  function collect(doc: { getConnections: () => unknown[] }): Closable[] {
    return (doc.getConnections() as Closable[]).filter(
      (c) => (c.context as { userId?: string } | null)?.userId === userId,
    );
  }
  for (const [documentName, doc] of server.hocuspocus.documents) {
    const mine = collect(doc);
    if (mine.length > 0) candidates.set(documentName, mine);
  }
  if (candidates.size === 0) return 0;

  // … und davon nur die trennen, deren Seite zu DIESEM Space gehoert.
  const pages = await prisma.page.findMany({
    where: { id: { in: [...candidates.keys()], }, spaceId },
    select: { id: true },
  });
  let closed = 0;
  for (const { id } of pages) {
    for (const connection of candidates.get(id) ?? []) {
      // Erst die Dokument-Verbindung sauber abmelden …
      connection.close();
      // … dann den Socket wirklich schliessen. Die Dokument-Nachricht
      // allein laesst den Client verbunden ("Live") weiterlaufen; erst
      // der Socket-Abbruch loest den Neuaufbau aus — und der scheitert
      // dann an der Zugriffspruefung in onAuthenticate.
      try {
        connection.webSocket.close(1000, "Zugriff entzogen");
      } catch {
        /* Socket war schon zu */
      }
      closed += 1;
    }
  }
  return closed;
}

function startDocResetListener(): void {
  const subscriber = redis.duplicate();
  subscriber.on("error", (e: Error) => log.warn({ err: e.message }, "redis-sub"));
  subscriber
    .subscribe(DOC_RESET_CHANNEL, ACCESS_REVOKED_CHANNEL)
    .catch((e: unknown) => {
      log.warn({ err: String(e) }, "Redis-Kanäle nicht abonniert");
    });
  subscriber.on("message", async (channel: string, raw: string) => {
    try {
      if (channel === ACCESS_REVOKED_CHANNEL) {
        const { userId, spaceId } = JSON.parse(raw) as {
          userId?: string;
          spaceId?: string;
        };
        if (!userId || !spaceId) return;
        const closed = await disconnectUserFromSpace(userId, spaceId);
        if (closed > 0) {
          log.info({ userId, spaceId, closed }, "Collab-Verbindungen getrennt");
        }
        return;
      }
      const { pageId, nonce } = JSON.parse(raw) as {
        pageId?: string;
        nonce?: string;
      };
      if (!pageId || !nonce) return;
      const won = await redis.set(
        `dokunc:doc-reset:${nonce}`,
        "1",
        "PX",
        60_000,
        "NX",
      );
      if (won !== "OK") return;
      if (await resetDocument(pageId)) {
        log.info({ pageId }, "Dokument aus der Datenbank neu aufgebaut");
      }
    } catch (e) {
      log.warn({ err: String(e) }, "Redis-Nachricht konnte nicht verarbeitet werden");
    }
  });
}

server.listen().then(() => {
  log.info({ port: PORT }, "Hocuspocus läuft");
  // Mail-Versand von Benachrichtigungen (periodisch, Redis-gelockt).
  startMailDispatcher({ redis, log });
  startDocResetListener();
});
