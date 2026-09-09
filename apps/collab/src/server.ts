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

/**
 * Audience der Collab-Tickets. Gegenstück: apps/web/src/lib/collab-ticket.ts.
 * Session-Cookies tragen diese Audience NICHT — ein erbeutetes
 * Sitzungstoken taugt hier also nicht als Eintrittskarte, und ein
 * Ticket nicht als Sitzung.
 */
const COLLAB_AUDIENCE = "dokunc-collab";

/**
 * Steuerkanal. Gegenstück: apps/web/src/lib/collab-control.ts
 * (dort stehen dieselben beiden Konstanten).
 */
const COLLAB_CONTROL_CHANNEL = "dokunc:collab:control";

/**
 * Signal an offene Clients: wirf dein Dokument weg und lade neu.
 * Gegenstück: apps/web/.../CollaborativeEditor.tsx.
 */
const COLLAB_RELOAD_SIGNAL = "dokunc:reload";

/** Mindestabstand zwischen History-Snapshots pro Seite (ms). */
const VERSION_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Wie lange eine Seite nach einer Wiederherstellung gesperrt bleibt.
 * In dieser Zeit wird ihr Zustand weder gespeichert noch werden neue
 * Verbindungen angenommen, damit die Web-App den neuen Inhalt in Ruhe
 * schreiben kann. Danach laden die Clients von selbst wieder.
 */
const RELOAD_LOCK_MS = 5000;

/**
 * Seiten, deren Dokument gerade neu aus der Datenbank aufgebaut wird
 * (Wert = Ablaufzeitpunkt der Sperre). Ohne diese Sperre schreibt eine
 * noch offene Sitzung den alten Stand direkt wieder zurück — genau so
 * ging "Version wiederherstellen" bisher lautlos verloren.
 */
const reloading = new Map<string, number>();

function isReloading(pageId: string): boolean {
  const until = reloading.get(pageId);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  reloading.delete(pageId);
  return false;
}

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
  if (!token) throw new Error("Kein Ticket");
  const { payload } = await jwtVerify(token, SECRET, {
    audience: COLLAB_AUDIENCE,
  });
  // Ein Ticket gilt für genau eine Seite. Damit nützt ein abgefangenes
  // Ticket höchstens für das Dokument, für das es ausgestellt wurde.
  if (payload.pid !== pageId) throw new Error("Ticket gilt anderer Seite");
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
    if (isReloading(data.documentName)) {
      throw new Error("Seite wird gerade wiederhergestellt");
    }
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
      Y.applyUpdate(data.document, Y.encodeStateAsUpdate(seeded));
    }
    return data.document;
  },

  async onStoreDocument(data) {
    const pageId = data.documentName;
    if (isReloading(pageId)) {
      log.info({ pageId }, "Speichern übersprungen: Seite wird neu geladen");
      return;
    }
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
        data: { content: json, textContent },
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
  await prisma.$transaction([
    prisma.pageChunk.deleteMany({
      where: { pageId, chunkIndex: { gte: chunks.length } },
    }),
    ...chunks.map((chunk, i) =>
      prisma.pageChunk.upsert({
        where: { pageId_chunkIndex: { pageId, chunkIndex: i } },
        // embedding auf null: Text hat sich geändert -> neu einbetten.
        create: { pageId, chunkIndex: i, text: chunk },
        update: { text: chunk, embedding: null },
      }),
    ),
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
 * Wirft ein Dokument aus dem Speicher und sperrt die Seite kurz.
 * Der reguläre Weg (`unloadDocument`) läuft zuerst, damit Extensions
 * ihre Aufräum-Hooks bekommen; bleibt das Dokument dabei hängen (etwa
 * weil noch ein Speichervorgang aussteht, der wegen der Sperre ohnehin
 * nichts mehr schreibt), wird es hart entfernt.
 */
async function evictDocument(pageId: string): Promise<void> {
  reloading.set(pageId, Date.now() + RELOAD_LOCK_MS);
  const hocuspocus = server.hocuspocus;
  const doc = hocuspocus.documents.get(pageId);

  /**
   * Offene Clients müssen ihr Yjs-Dokument wegwerfen. Sie nur zu
   * trennen genügt nicht: beim Reconnect führt Yjs ihren alten Stand
   * mit dem frisch geladenen zusammen und macht die Wiederherstellung
   * damit rückgängig — ein CRDT kennt kein "verwirf das".
   */
  doc?.broadcastStateless(COLLAB_RELOAD_SIGNAL);
  // Dem Signal einen Moment geben, bevor die Sockets zugehen.
  await new Promise((r) => setTimeout(r, 100));

  hocuspocus.closeConnections(pageId);
  if (!doc) return;

  // Den geschlossenen Verbindungen kurz Zeit geben, sich abzumelden.
  await new Promise((r) => setTimeout(r, 150));
  await hocuspocus.unloadDocument(doc).catch(() => {});

  if (hocuspocus.documents.get(pageId) === doc) {
    hocuspocus.documents.delete(pageId);
    try {
      doc.destroy();
    } catch {
      /* bereits abgebaut */
    }
  }
}

/** Steuerkanal der Web-App abonnieren (Räumung nach Wiederherstellung). */
function subscribeControlChannel(): void {
  const control = redis.duplicate();
  control.on("error", (e: Error) =>
    log.warn({ err: e.message }, "redis control"),
  );
  control.on("message", (channel: string, raw: string) => {
    if (channel !== COLLAB_CONTROL_CHANNEL) return;
    void (async () => {
      try {
        const msg = JSON.parse(raw) as {
          op?: string;
          pageId?: string;
          ack?: string;
        };
        if (msg.op !== "evict" || !msg.pageId) return;
        await evictDocument(msg.pageId);
        log.info({ pageId: msg.pageId }, "Dokument geräumt");
        if (msg.ack) await redis.publish(msg.ack, "ok");
      } catch (e) {
        log.warn({ err: String(e) }, "Steuerbefehl fehlgeschlagen");
      }
    })();
  });
  control
    .subscribe(COLLAB_CONTROL_CHANNEL)
    .catch((e: Error) =>
      log.warn({ err: e.message }, "Steuerkanal nicht abonniert"),
    );
}

server.listen().then(() => {
  subscribeControlChannel();
  log.info({ port: PORT }, "Hocuspocus läuft");
});
