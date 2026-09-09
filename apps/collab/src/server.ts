// WICHTIG: env-Import zuerst — lädt .env bevor @dokunc/db o.ä. sie lesen.
import "./env";
import { Server, type Connection } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { jwtVerify } from "jose";
import { Redis } from "ioredis";
import { Redis as HocuspocusRedis } from "@hocuspocus/extension-redis";
import pino from "pino";
import * as Y from "yjs";
import {
  canSeePage,
  effectiveSpaceRole,
  isAtLeast,
  prisma,
  strongestSpaceRole,
  type SpaceRole,
} from "@dokunc/db";
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

/**
 * Audience der Collab-Tickets. Gegenstück: apps/web/src/lib/collab-ticket.ts.
 * Session-Cookies tragen diese Audience NICHT — ein erbeutetes
 * Sitzungstoken taugt hier also nicht als Eintrittskarte, und ein
 * Ticket nicht als Sitzung.
 */
const COLLAB_AUDIENCE = "dokunc-collab";

/**
 * Kanal für Live-Benachrichtigungen.
 * Gegenstück: apps/web/src/lib/notify-bus.ts.
 */
const NOTIFY_CHANNEL_PREFIX = "dokunc:notify:";

/**
 * Kanal, über den die Web-App bittet, ein Dokument neu aus der Datenbank
 * aufzubauen (Wiederherstellen einer Version). Muss zu
 * apps/web/src/lib/collab-sync.ts passen.
 */
const DOC_RESET_CHANNEL = "dokunc:doc-reset";
/** Muss zu apps/web/src/lib/collab-sync.ts passen. */
const ACCESS_REVOKED_CHANNEL = "dokunc:access-revoked";
/** Entzug auf einer einzelnen Seite (Schutz gesetzt, Freigabe entzogen). */
const PAGE_ACCESS_CHANNEL = "dokunc:page-access";

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
  if (!token) throw new Error("Kein Ticket");
  const { payload } = await jwtVerify(token, SECRET, {
    audience: COLLAB_AUDIENCE,
  });
  // Ein Ticket gilt für genau eine Seite. Damit nützt ein abgefangenes
  // Ticket höchstens für das Dokument, für das es ausgestellt wurde.
  if (payload.pid !== pageId) throw new Error("Ticket gilt anderer Seite");
  const userId = String(payload.sub);
  const tokenVersion = Number(payload.tv ?? 0);
  const sessionId = String(payload.sid ?? "");
  if (!sessionId) throw new Error("Ticket ohne Sitzung");

  // Widerruf gilt auch für den WebSocket: die Anmeldung muss noch
  // bestehen, das Konto aktiv und die Token-Version aktuell sein.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      userId: true,
      revokedAt: true,
      expiresAt: true,
      user: { select: { isActive: true, tokenVersion: true } },
    },
  });
  if (
    !session ||
    session.userId !== userId ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() < Date.now() ||
    !session.user.isActive ||
    session.user.tokenVersion !== tokenVersion
  ) {
    throw new Error("Sitzung ungültig");
  }

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { spaceId: true, deletedAt: true },
  });
  if (!page || page.deletedAt) throw new Error("Seite nicht gefunden");

  // Rolle aus eigener Mitgliedschaft und Gruppen, danach die
  // Sichtbarkeit der Seite selbst: eine geschützte Seite öffnet auch
  // ein Space-Mitglied nur mit Freigabe.
  const role = await effectiveSpaceRole(userId, page.spaceId);
  if (!role) throw new Error("Kein Zugriff auf diesen Space");
  if (!(await canSeePage(pageId, userId, role))) {
    throw new Error("Kein Zugriff auf diese Seite");
  }

  const readOnly = role === "VIEWER";
  return { userId, tokenVersion, sessionId, readOnly };
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
    const { userId, tokenVersion, sessionId, readOnly } = await authorize(
      data.token,
      data.documentName,
    );
    data.connectionConfig.readOnly = readOnly;
    // Token-Version und Sitzung wandern in den Kontext, damit die
    // wiederkehrende Prüfung sie ohne neues Ticket vergleichen kann.
    return { userId, tokenVersion, sessionId };
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
 * vorherigen Stand NEU erwähnt wurden — und die den Space betreten und
 * diese Seite auch öffnen dürfen.
 *
 * Die Mail dazu verschickt der Dispatcher (siehe ./mail-dispatcher):
 * er kennt das Sammelfenster, den Tagesdigest und
 * `User.emailNotifications`. Hier wird nur die Zeile angelegt — zwei
 * Versandwege nebeneinander hiessen zwei Mails pro Erwähnung.
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

  // Zugang zum Space über die eigene Mitgliedschaft ODER eine Gruppe.
  const candidates = await prisma.user.findMany({
    where: {
      id: { in: added },
      OR: [
        { memberships: { some: { spaceId } } },
        {
          groupMemberships: {
            some: { group: { spaces: { some: { spaceId } } } },
          },
        },
      ],
    },
    select: { id: true },
  });

  // Eine Erwähnung auf einer geschützten Seite darf niemanden erreichen,
  // der die Seite nicht öffnen kann — Titel und Auszug stünden sonst in
  // der Benachrichtigung.
  const reachable: string[] = [];
  for (const candidate of candidates) {
    const role = await effectiveSpaceRole(candidate.id, spaceId);
    if (role && (await canSeePage(pageId, candidate.id, role))) {
      reachable.push(candidate.id);
    }
  }

  const notified: string[] = [];
  for (const userId of reachable) {
    const exists = await prisma.notification.findFirst({
      where: { userId, pageId, type: "MENTION", readAt: null },
      select: { id: true },
    });
    if (!exists) {
      await prisma.notification.create({
        data: { userId, actorId, type: "MENTION", pageId },
      });
      notified.push(userId);
    }
  }

  // Glocke der erwähnten Person sofort aktualisieren.
  await Promise.all(
    notified.map((userId) =>
      redis
        .publish(`${NOTIFY_CHANNEL_PREFIX}${userId}`, "1")
        .catch(() => undefined),
    ),
  );
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
 * Ersetzt den Inhalt eines Yjs-Dokuments durch den gespeicherten
 * `Page.content`.
 *
 * Ohne das bliebe ein geöffnetes Dokument im Speicher unverändert: die
 * Web-App schreibt beim Wiederherstellen nur `Page.content`, der nächste
 * `onStoreDocument` schriebe den alten Speicherstand zurück — die
 * Wiederherstellung wäre still verpufft. Über eine Direktverbindung
 * gesetzt, ziehen offene Editoren den Stand sofort nach.
 *
 * Es gibt bewusst NUR diesen einen Weg: ein zweiter, der das Dokument
 * stattdessen aus dem Speicher wirft, würde den hier frisch gesetzten
 * Inhalt gleich wieder wegräumen.
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
 * Verbindung wirklich beenden.
 *
 * Erst die Dokument-Verbindung sauber abmelden, dann den Socket
 * schliessen: die Dokument-Nachricht allein laesst den Client verbunden
 * ("Live") weiterlaufen; erst der Socket-Abbruch loest den Neuaufbau
 * aus — und der scheitert dann an der Pruefung in `onAuthenticate`.
 */
function closeConnection(connection: Connection, reason: string): void {
  connection.close();
  try {
    connection.webSocket.close(1000, reason);
  } catch {
    /* Socket war schon zu */
  }
}

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
  const candidates = new Map<string, Connection[]>();
  for (const [documentName, doc] of server.hocuspocus.documents) {
    const mine = doc
      .getConnections()
      .filter(
        (c) => (c.context as { userId?: string } | null)?.userId === userId,
      );
    if (mine.length > 0) candidates.set(documentName, mine);
  }
  if (candidates.size === 0) return 0;

  // … und davon nur die trennen, deren Seite zu DIESEM Space gehoert.
  const pages = await prisma.page.findMany({
    where: { id: { in: [...candidates.keys()] }, spaceId },
    select: { id: true },
  });
  let closed = 0;
  for (const { id } of pages) {
    for (const connection of candidates.get(id) ?? []) {
      closeConnection(connection, "Zugriff entzogen");
      closed += 1;
    }
  }
  return closed;
}

/**
 * Wiederkehrende Rechteprüfung für offene Verbindungen.
 *
 * `onAuthenticate` läuft genau einmal, beim Verbindungsaufbau. Der
 * Entzug über den Redis-Kanal greift sofort, aber nur, wenn ihn jemand
 * ausgelöst hat. Diese Runde ist das Netz darunter: sie bemerkt auch
 * eine abgelaufene Sitzung, ein deaktiviertes Konto oder eine entzogene
 * Freigabe, die niemand gemeldet hat.
 */
const REVOCATION_INTERVAL_MS = 60_000;

/**
 * Verbindungen zu einer Seite und ihrem geschuetzten Unterbaum neu
 * pruefen.
 *
 * Der Schutz vererbt sich, deshalb genuegt es nicht, nur das Dokument
 * dieser einen Seite anzusehen: jede offene Seite, deren Schutzwurzel
 * die geaenderte Seite ist, ist mitbetroffen. `refreshAccessRoots` ist
 * auf der Web-Seite bereits gelaufen, bevor diese Nachricht kommt, also
 * steht accessRootId hier schon richtig.
 */
async function enforcePageAccess(pageId: string): Promise<number> {
  const offen = [...server.hocuspocus.documents.keys()];
  if (offen.length === 0) return 0;

  const seiten = await prisma.page.findMany({
    where: {
      id: { in: offen },
      OR: [{ id: pageId }, { accessRootId: pageId }],
    },
    select: { id: true, spaceId: true },
  });

  let geschlossen = 0;
  for (const seite of seiten) {
    const doc = server.hocuspocus.documents.get(seite.id);
    if (!doc) continue;
    for (const connection of doc.getConnections()) {
      const userId = (connection.context as { userId?: string } | null)?.userId;
      if (!userId) continue;
      const rolle = await effectiveSpaceRole(userId, seite.spaceId);
      if (rolle && (await canSeePage(seite.id, userId, rolle))) continue;
      closeConnection(connection, "Zugriff auf diese Seite entzogen");
      geschlossen += 1;
    }
  }
  return geschlossen;
}

async function enforceRevocations(): Promise<void> {
  const hocuspocus = server.hocuspocus;
  const open = [...hocuspocus.documents.entries()].filter(
    ([, doc]) => doc.connections.size > 0,
  );
  if (open.length === 0) return;

  const pages = await prisma.page.findMany({
    where: { id: { in: open.map(([pageId]) => pageId) } },
    select: { id: true, spaceId: true, deletedAt: true, accessRootId: true },
  });
  const pageById = new Map(pages.map((p) => [p.id, p]));

  /**
   * Freigaben der geschützten Seiten, die gerade offen sind.
   *
   * Wird eine Seite geschützt oder eine Freigabe entzogen, während
   * jemand darin schreibt, muss diese Runde die Verbindung schliessen —
   * sie ist die einzige Prüfung, die einen entzogenen Eintrag bemerkt,
   * ohne dass jemand etwas ausgelöst hat.
   */
  const roots = [
    ...new Set(
      pages.map((p) => p.accessRootId).filter((id): id is string => !!id),
    ),
  ];
  const grantedByRoot = new Map<string, Set<string>>();
  if (roots.length > 0) {
    const grants = await prisma.pageGrant.findMany({
      where: { pageId: { in: roots } },
      select: {
        pageId: true,
        userId: true,
        group: { select: { members: { select: { userId: true } } } },
      },
    });
    for (const grant of grants) {
      let allowed = grantedByRoot.get(grant.pageId);
      if (!allowed) {
        allowed = new Set<string>();
        grantedByRoot.set(grant.pageId, allowed);
      }
      if (grant.userId) allowed.add(grant.userId);
      for (const m of grant.group?.members ?? []) allowed.add(m.userId);
    }
  }

  const userIds = new Set<string>();
  for (const [, doc] of open) {
    for (const connection of doc.connections.keys()) {
      const userId = (connection.context as { userId?: string })?.userId;
      if (userId) userIds.add(userId);
    }
  }
  if (userIds.size === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, isActive: true, tokenVersion: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const sessionIds = new Set<string>();
  for (const [, doc] of open) {
    for (const connection of doc.connections.keys()) {
      const sid = (connection.context as { sessionId?: string })?.sessionId;
      if (sid) sessionIds.add(sid);
    }
  }
  const sessions = await prisma.session.findMany({
    where: { id: { in: [...sessionIds] } },
    select: { id: true, revokedAt: true, expiresAt: true },
  });
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // Rollen inklusive Gruppen: sonst flöge jemand aus der Sitzung, der
  // nur über eine Gruppe im Space ist.
  const [members, groupRoles] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, spaceId: true, role: true },
    }),
    prisma.spaceGroup.findMany({
      where: { group: { members: { some: { userId: { in: [...userIds] } } } } },
      select: {
        spaceId: true,
        role: true,
        group: { select: { members: { select: { userId: true } } } },
      },
    }),
  ]);
  const roleByKey = new Map<string, SpaceRole>();
  const note = (userId: string, spaceId: string, role: SpaceRole) => {
    const key = `${userId}:${spaceId}`;
    const best = strongestSpaceRole([roleByKey.get(key), role]);
    if (best) roleByKey.set(key, best);
  };
  for (const m of members) note(m.userId, m.spaceId, m.role);
  for (const g of groupRoles) {
    for (const m of g.group.members) {
      if (userIds.has(m.userId)) note(m.userId, g.spaceId, g.role);
    }
  }

  for (const [pageId, doc] of open) {
    const page = pageById.get(pageId);
    for (const connection of doc.connections.keys()) {
      const ctx = connection.context as {
        userId?: string;
        tokenVersion?: number;
        sessionId?: string;
      };
      const session = ctx.sessionId
        ? sessionById.get(ctx.sessionId)
        : undefined;
      const user = ctx.userId ? userById.get(ctx.userId) : undefined;
      const role =
        page && ctx.userId
          ? roleByKey.get(`${ctx.userId}:${page.spaceId}`)
          : undefined;

      const revoked =
        !page ||
        page.deletedAt !== null ||
        !session ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() < Date.now() ||
        !user ||
        !user.isActive ||
        user.tokenVersion !== ctx.tokenVersion ||
        !role ||
        // Geschützte Seite ohne Freigabe: die Space-Verwaltung sieht
        // weiterhin alles, alle anderen brauchen einen Eintrag.
        (!!page?.accessRootId &&
          !isAtLeast(role, "ADMIN") &&
          !grantedByRoot
            .get(page.accessRootId)
            ?.has(ctx.userId as string)) ||
        // Herabstufung auf VIEWER: die Verbindung darf nicht mehr
        // schreiben, also muss sie neu aufgebaut werden.
        (role === "VIEWER") !== connection.readOnly;

      if (revoked) {
        log.info({ pageId, userId: ctx.userId }, "Verbindung getrennt: Zugriff entzogen");
        closeConnection(connection, "Zugriff entzogen");
      }
    }
  }
}

/**
 * Auf Wünsche der Web-App hören: Dokument neu aufbauen (Wiederherstellen
 * einer Version) und Verbindungen nach einem Zugriffsentzug trennen.
 * Der Nonce-Lock stellt sicher, dass bei mehreren Instanzen GENAU EINE
 * das Dokument ersetzt — sonst fügten zwei Instanzen ihre Kopie ein und
 * der Inhalt stünde doppelt da.
 */
function startDocResetListener(): void {
  const subscriber = redis.duplicate();
  subscriber.on("error", (e: Error) => log.warn({ err: e.message }, "redis-sub"));
  subscriber
    .subscribe(DOC_RESET_CHANNEL, ACCESS_REVOKED_CHANNEL, PAGE_ACCESS_CHANNEL)
    .catch((e: unknown) => {
      log.warn({ err: String(e) }, "Redis-Kanäle nicht abonniert");
    });
  subscriber.on("message", async (channel: string, raw: string) => {
    try {
      if (channel === PAGE_ACCESS_CHANNEL) {
        const { pageId } = JSON.parse(raw) as { pageId?: string };
        if (!pageId) return;
        const closed = await enforcePageAccess(pageId);
        if (closed > 0) {
          log.info({ pageId, closed }, "Verbindungen nach Zugriffsaenderung getrennt");
        }
        return;
      }
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
  setInterval(() => {
    void enforceRevocations().catch((e) =>
      log.warn({ err: String(e) }, "Rechteprüfung fehlgeschlagen"),
    );
  }, REVOCATION_INTERVAL_MS).unref();
});
