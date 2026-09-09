// WICHTIG: env-Import zuerst — lädt .env bevor @dokunc/db o.ä. sie lesen.
import "./env";
import { Server } from "@hocuspocus/server";
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
import { mentionMail, send } from "@dokunc/mailer";
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

/**
 * Kanal für Live-Benachrichtigungen.
 * Gegenstück: apps/web/src/lib/notify-bus.ts.
 */
const NOTIFY_CHANNEL_PREFIX = "dokunc:notify:";

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
    if (isReloading(data.documentName)) {
      throw new Error("Seite wird gerade wiederhergestellt");
    }
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
 * vorherigen Stand NEU erwähnt wurden — und die den Space betreten und
 * diese Seite auch öffnen dürfen.
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

  const withAccess = await prisma.user.findMany({
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
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      emailOnMention: true,
    },
  });
  // Eine Erwähnung auf einer geschützten Seite darf niemanden erreichen,
  // der die Seite nicht öffnen kann — der Auszug stünde sonst in der
  // Mail.
  const reachable: typeof withAccess = [];
  for (const candidate of withAccess) {
    const role = await effectiveSpaceRole(candidate.id, spaceId);
    if (role && (await canSeePage(pageId, candidate.id, role))) {
      reachable.push(candidate);
    }
  }
  const members = reachable.map((user) => ({ user }));

  const notified: typeof members = [];
  for (const member of members) {
    const userId = member.user.id;
    const exists = await prisma.notification.findFirst({
      where: { userId, pageId, type: "MENTION", readAt: null },
      select: { id: true },
    });
    if (!exists) {
      await prisma.notification.create({
        data: { userId, actorId, type: "MENTION", pageId },
      });
      notified.push(member);
    }
  }

  // Glocke der erwähnten Person sofort aktualisieren.
  await Promise.all(
    notified.map((m) =>
      redis
        .publish(`${NOTIFY_CHANNEL_PREFIX}${m.user.id}`, "1")
        .catch(() => undefined),
    ),
  );

  await mailMentions(pageId, actorId, notified);
}

/**
 * Erwähnungen per E-Mail.
 *
 * Erwähnungen entstehen hier im Collab-Server, nicht in der Web-App —
 * ohne diesen Weg gäbe es für sie keine Nachricht. Fehler beim Versand
 * bleiben folgenlos für das Speichern des Dokuments.
 */
async function mailMentions(
  pageId: string,
  actorId: string | undefined,
  recipients: {
    user: {
      email: string;
      isActive: boolean;
      emailOnMention: boolean;
    };
  }[],
): Promise<void> {
  const wanted = recipients.filter(
    (r) => r.user.isActive && r.user.emailOnMention,
  );
  if (wanted.length === 0) return;

  const [page, actor] = await Promise.all([
    prisma.page.findUnique({
      where: { id: pageId },
      select: { title: true, textContent: true },
    }),
    actorId
      ? prisma.user.findUnique({
          where: { id: actorId },
          select: { name: true },
        })
      : Promise.resolve(null),
  ]);

  await Promise.all(
    wanted.map((r) =>
      send(
        mentionMail({
          to: r.user.email,
          actorName: actor?.name ?? "Jemand",
          pageTitle: page?.title || "Ohne Titel",
          pageId,
          snippet: page?.textContent ?? "",
        }),
      ).catch((e: unknown) =>
        log.warn({ err: String(e) }, "Erwähnungs-Mail fehlgeschlagen"),
      ),
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

/**
 * Wiederkehrende Rechteprüfung für offene Verbindungen.
 *
 * `onAuthenticate` läuft genau einmal, beim Verbindungsaufbau. Wer
 * danach aus dem Space entfernt, deaktiviert oder auf VIEWER gesetzt
 * wurde, schrieb bisher munter weiter — bis er die Seite neu lud.
 * Diese Runde trennt solche Verbindungen; der Client verbindet sich neu
 * und läuft dann durch die volle Prüfung.
 */
const REVOCATION_INTERVAL_MS = 60_000;

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
   * jemand darin schreibt, muss diese Runde die Verbindung schliessen.
   * Die Räumung über den Kontrollkanal greift sofort, diese Prüfung ist
   * das Netz darunter — und die einzige, die einen entzogenen Eintrag
   * bemerkt, ohne dass jemand etwas ausgelöst hat.
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
        connection.close();
      }
    }
  }
}

server.listen().then(() => {
  subscribeControlChannel();
  setInterval(() => {
    void enforceRevocations().catch((e) =>
      log.warn({ err: String(e) }, "Rechteprüfung fehlgeschlagen"),
    );
  }, REVOCATION_INTERVAL_MS).unref();
  log.info({ port: PORT }, "Hocuspocus läuft");
});
