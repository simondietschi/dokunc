// WICHTIG: env-Import zuerst — lädt .env bevor @dokunc/db o.ä. sie lesen.
import "./env";
import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import { Server, type Connection } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { jwtVerify, type JWTPayload } from "jose";
import { Redis } from "ioredis";
import { Redis as HocuspocusRedis } from "@hocuspocus/extension-redis";
import pino from "pino";
import * as Y from "yjs";
import {
  canSeePage,
  canSeePageWithGrant,
  effectiveSpaceRole,
  indexPageChunks,
  prisma,
  strongestSpaceRole,
  type SpaceRole,
} from "@dokunc/db";
import {
  richExtensions,
  // Die Protokollwerte, auf die sich Web-App und Collab-Server einigen
  // muessen (Feldname, Ticket-Audience, Redis-Kanaele), stehen im
  // gemeinsamen Paket: packages/editor/src/collab-protocol.ts. Doppelt
  // gepflegt faellt eine einseitige Umbenennung nirgends auf — der
  // Server abonnierte einen Kanal, auf dem niemand mehr sendet, und
  // Wiederherstellung wie Zugriffsentzug blieben stumm liegen.
  COLLAB_FIELD,
  COLLAB_AUDIENCE,
  COLLAB_REJECT_REASON,
  NOTIFY_CHANNEL_PREFIX,
  DOC_RESET_CHANNEL,
  DOC_RESET_ACK_PREFIX,
  DOC_RESET_ACK_TTL_SEC,
  ACCESS_REVOKED_CHANNEL,
  PAGE_ACCESS_CHANNEL,
  isDocResetMessage,
  isAccessRevokedMessage,
  isPageAccessMessage,
  extractWikiLinkIds,
  extractMentionIds,
  chunkForAiIndex,
  type DocResetMessage,
} from "@dokunc/editor";
import { startMailDispatcher } from "./mail-dispatcher";
import { startAiIndexer } from "./ai-indexer";
import { createDocResetHandler, type ResetContent } from "./doc-reset";
import { resolveAppSecret } from "./secret";
import { StoreWatch } from "./store-watch";
import {
  ATTEMPT_WINDOW_SEC,
  AuthDeadlines,
  SocketGate,
  UNAUTHENTICATED_TIMEOUT_MS,
  UserSlots,
  clientAddress,
  readConnectionLimits,
  trustedProxyHops,
} from "./limits";
import { createAttemptLimiter, createTicketLedger } from "./redis-guards";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "dokunc-collab" },
  // ioredis haengt an Fehler den Befehl samt Argumenten an; bei einem
  // gescheiterten AUTH steht dort das Passwort aus REDIS_URL. jose haengt
  // an Claim-Fehler den Inhalt des Tokens an. Dieselbe Schwaerzung wie in
  // apps/web/src/lib/log.ts (dort mit Begruendung und Test); dazu die
  // Ursache, weil verifyTicket den Fehler von jose als `cause` weiterreicht.
  // Der heutige Serializer faltet sie nur in Meldung und Stack; der
  // Eintrag haelt die Schwaerzung auch fuer einen, der sie als Objekt
  // schreibt.
  redact: [
    "*.password",
    "*.passwordHash",
    "err.command.args",
    "err.payload",
    "err.cause.payload",
  ],
});

const PORT = Number(process.env.COLLAB_PORT ?? 3001);

// Ohne eigenes APP_SECRET nur unter NODE_ENV=development (Begruendung in
// ./secret).
const SECRET = new TextEncoder().encode(
  resolveAppSecret(process.env.APP_SECRET, process.env.NODE_ENV),
);
const extensions = richExtensions();

/** Mindestabstand zwischen History-Snapshots pro Seite (ms). */
const VERSION_INTERVAL_MS = 2 * 60 * 1000;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});
redis.on("error", (e: Error) => log.warn({ err: e }, "redis"));

/*
 * Grenzen fuer Verbindungen (Begruendung der Vorgaben in ./limits).
 *
 * Zwei Stufen, weil die Person erst mit dem Ticket bekannt ist und das
 * Ticket erst nach dem Handshake als erste Nachricht kommt:
 *
 *  - vor dem Handshake (onUpgrade): Versuche je IP, offene Sockets der
 *    Instanz und je IP. Abgewiesen wird mit HTTP-Status, der Provider im
 *    Browser versucht es dann mit wachsendem Abstand erneut und holt
 *    dafuer nicht einmal ein Ticket. Wer durchkommt, muss sich binnen
 *    UNAUTHENTICATED_TIMEOUT_MS anmelden, sonst wird der Socket
 *    geschlossen.
 *  - bei der Anmeldung (onAuthenticate): Versuche je Person und
 *    gleichzeitige Verbindungen je Person, dazu der Verbrauch des Tickets.
 */
const limits = readConnectionLimits(process.env, (detail, msg) =>
  log.warn(detail, msg),
);
const proxyHops = trustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
const sockets = new SocketGate(
  limits.maxConnections,
  limits.maxConnectionsPerIp,
);
const authDeadlines = new AuthDeadlines(UNAUTHENTICATED_TIMEOUT_MS);

/**
 * Kopfzeile, ueber die onAuthenticate die Anmeldefrist seines Sockets
 * findet. Hocuspocus reicht den rohen Socket nicht bis zur Anmeldung
 * durch, wohl aber die Kopfzeilen der Upgrade-Anfrage; onUpgrade setzt
 * dort eine zufaellige Kennung und ueberschreibt dabei, was ein Client
 * selbst unter diesem Namen schickt.
 */
const UPGRADE_ID_HEADER = "x-dokunc-upgrade-id";
const userSlots = new UserSlots(limits.maxConnectionsPerUser);
const attemptConnection = createAttemptLimiter(redis, (err) =>
  log.warn(
    { err },
    "Verbindungsbremse: Redis nicht erreichbar, zaehle im Prozess",
  ),
);
const consumeTicket = createTicketLedger(redis, (err) =>
  log.warn(
    { err },
    "Ticketverbrauch: Redis nicht erreichbar, merke im Prozess",
  ),
);

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
  } catch (e) {
    // Ohne diese Meldung bliebe unbemerkt, dass die Drosselung gerade
    // aus ist: statt eines Eintrags alle zwei Minuten schriebe dann
    // jeder einzelne Speicherlauf eine volle PageVersion-Zeile.
    log.warn(
      { err: e, pageId },
      "Snapshot-Drossel nicht erreichbar, History ungedrosselt",
    );
    return true;
  }
}

/**
 * Gegenstück zu `shouldSnapshot`: gibt das Zeitfenster wieder frei,
 * wenn der Snapshot nach dem Belegen doch nicht zustande kam.
 * Scheitert auch das Löschen, verfällt der Schlüssel spätestens nach
 * VERSION_INTERVAL_MS von selbst — dann bleibt es beim alten Verhalten.
 */
async function releaseSnapshot(pageId: string): Promise<void> {
  try {
    await redis.del(`dokunc:snapshot:${pageId}`);
  } catch (e) {
    log.warn(
      { err: e, pageId },
      "Snapshot-Drossel nicht freigegeben, History-Lücke möglich",
    );
  }
}

/** Was ein gepruefter Ticket-Kopf zusichert. */
type Ticket = {
  userId: string;
  tokenVersion: number;
  sessionId: string;
  /** Kennung des Tickets, ueber die es genau einmal eingeloest wird. */
  jti: string;
  /** Restlaufzeit (s): so lange muss der Verbrauch gemerkt bleiben. */
  ttlSec: number;
};

/**
 * Ticket pruefen, soweit das ohne Datenbank geht: Signatur, Audience,
 * Ablauf, Seite.
 *
 * Getrennt von `checkTicketAccess`, weil dazwischen die Bremse je Person
 * zaehlt. Erst nach der Signatur ist `sub` verlaesslich — zaehlte die
 * Bremse vorher, koennte jeder mit erfundenen Tickets eine fremde
 * Person aussperren. Und erst danach kosten Versuche Datenbankabfragen.
 */
async function verifyTicket(
  token: string | undefined,
  pageId: string,
): Promise<Ticket> {
  if (!token) throw new Error("Kein Ticket");
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, SECRET, {
      audience: COLLAB_AUDIENCE,
      // Ohne jti liesse sich das Ticket nicht einloesen, ohne exp waere
      // unbegrenzt, wie lange der Verbrauch zu merken ist.
      requiredClaims: ["sub", "exp", "jti"],
    }));
  } catch (e) {
    // jose haengt an Claim-Fehler ein eigenes Feld `reason` ("missing",
    // "check_failed"), und Hocuspocus schickt das `reason` des
    // geworfenen Fehlers als Grund der Ablehnung an den Client. Dort
    // gehoeren nur die vereinbarten Gruende hin (COLLAB_REJECT_REASON oder
    // der Standard "permission-denied"). Die Meldung — ohne Tokeninhalt —
    // bleibt fuer das Log, der Fehler von jose haengt als Ursache daran
    // (ohne sein `payload` im Log, siehe Schwaerzung oben).
    throw new Error(
      `Ticket ungueltig: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  // Ein Ticket gilt für genau eine Seite. Damit nützt ein abgefangenes
  // Ticket höchstens für das Dokument, für das es ausgestellt wurde.
  if (payload.pid !== pageId) throw new Error("Ticket gilt anderer Seite");
  const sessionId = String(payload.sid ?? "");
  if (!sessionId) throw new Error("Ticket ohne Sitzung");
  return {
    userId: String(payload.sub),
    tokenVersion: Number(payload.tv ?? 0),
    sessionId,
    jti: String(payload.jti),
    ttlSec: Number(payload.exp) - Math.floor(Date.now() / 1000),
  };
}

/** Sitzung, Konto, Seite und Rolle eines Tickets gegen die Datenbank pruefen. */
async function checkTicketAccess(
  ticket: Ticket,
  pageId: string,
): Promise<{ readOnly: boolean }> {
  const { userId, tokenVersion, sessionId } = ticket;

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

  return { readOnly: role === "VIEWER" };
}

/**
 * Ablehnung an einer Grenze, mit Grund fuer den Editor.
 *
 * Bewusst kein Error: Hocuspocus schreibt die Meldung jedes geworfenen
 * Errors ungebremst auf stderr, und wer an einer Grenze abprallt,
 * klopft wieder an. Gemeldet wird hier selbst, fuer die Bremse nur
 * beim ersten Abprallen im Fenster. Den `reason` schickt Hocuspocus als
 * Grund der Ablehnung an den Client (sonst "permission-denied").
 *
 * Den Socket schliesst die Ablehnung bewusst NICHT sofort: der Provider
 * baut eine geschlossene, schon einmal offene Verbindung nach einer
 * Sekunde neu auf, holt ein frisches Ticket und prallt wieder ab — eine
 * Schleife im Sekundentakt gegen Ticket-Route und Datenbank. Offen
 * gelassen schliesst ihn die Anmeldefrist aus onUpgrade nach
 * UNAUTHENTICATED_TIMEOUT_MS (15 s), und der naechste Versuch kommt erst
 * dann. (Ohne diese Frist taete es Hocuspocus erst nach 60 bis 120 s:
 * sein Timeout von 60 s wird im selben Takt geprueft.)
 */
function limitRejection(reason: string): { reason: string } {
  return { reason };
}

/**
 * Aufgebaute Dokument-Verbindungen einer Person auf dieser Instanz.
 * Gezaehlt aus dem Zustand von Hocuspocus statt mitgezaehlt: ein
 * eigener Zaehler liefe bei jedem verpassten Trennen davon (siehe
 * UserSlots).
 */
function establishedConnections(userId: string): number {
  let n = 0;
  for (const doc of server.hocuspocus.documents.values()) {
    for (const connection of doc.getConnections()) {
      const ctx = connection.context as { userId?: string } | null;
      if (ctx?.userId === userId) n += 1;
    }
  }
  return n;
}

/** Schluessel einer Anmeldung: ein Socket kann mehrere Dokumente tragen. */
function slotKey(socketId: string, documentName: string): string {
  return `${socketId}\0${documentName}`;
}

/**
 * Upgrade-Anfrage mit HTTP-Status beantworten und den Socket schliessen.
 *
 * Der Browser zeigt den Status nicht an — fuer ihn ist es ein
 * gescheiterter Verbindungsaufbau, den der Provider mit wachsendem
 * Abstand wiederholt —, aber Proxy-Logs und Werkzeuge sehen den Grund.
 * Erst nach dem Senden zerstoeren: ein sofortiges destroy() verwirft,
 * was noch im Puffer liegt.
 */
function refuseUpgrade(
  socket: Duplex,
  status: number,
  message: string,
  retryAfterSec: number,
): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.once("finish", () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      `Retry-After: ${retryAfterSec}\r\n` +
      "\r\n" +
      message,
  );
}

/** Wer auf das Speichern eines Doc-Resets wartet (siehe ./store-watch). */
const storeWatch = new StoreWatch();

/**
 * "Instanz voll" und "Adresse voll" hoechstens alle zehn Sekunden
 * melden: wer an einer vollen Grenze steht, versucht es weiter, und das
 * Log liefe mit.
 */
let lastFullLogAt = 0;
let lastAddressFullLogAt = 0;

// HA: mehrere Collab-Instanzen koordinieren Yjs-Dokumente + Awareness
// über Redis Pub/Sub. Jede Instanz, zu der Verbindungen bestehen, hält
// das Dokument selbst im Speicher und abonniert dafür den Kanal
// `<prefix>:<pageId>`; die Instanzen gleichen ihre Stände darüber ab.
// Der Doc-Reset stützt sich darauf (siehe ./doc-reset).
//
// Die Extension dupliziert den bestehenden Client, statt REDIS_URL ein
// zweites Mal auszuwerten. Würden hier nur Host und Port übergeben,
// fielen Benutzer, Passwort, Datenbanknummer und TLS aus derselben
// Variable weg: bei `redis://:geheim@host` wiese Redis die Anmeldung ab,
// bei `rediss://` verschwände still die Verschlüsselung — und die
// Koordination der Instanzen liefe nicht, während alle übrigen
// Redis-Zugriffe desselben Prozesses funktionieren.
//
// Der Cast überbrückt nur, dass die Extension eine eigene, ältere
// ioredis-Typfassung mitbringt — zur Laufzeit ist es dieselbe Klasse.
type HaRedisInstance = NonNullable<
  ConstructorParameters<typeof HocuspocusRedis>[0]["redis"]
>;
const haExtension = new HocuspocusRedis({
  redis: redis as unknown as HaRedisInstance,
});

const server = new Server({
  port: PORT,
  extensions: [haExtension],

  /**
   * Vor dem WebSocket-Handshake: Versuche je IP, offene Sockets der
   * Instanz und je IP, dazu die Anmeldefrist. Wird hier abgewiesen, muss
   * das Versprechen OHNE Fehler abgelehnt werden: Hocuspocus bricht das
   * Upgrade dann still ab, einen echten Fehler wuerfe es dagegen aus
   * seinem Upgrade-Handler weiter, und eine unbehandelte Ablehnung
   * beendet den Prozess.
   */
  async onUpgrade({ request, socket }) {
    const upgradeSocket = socket as Duplex;
    // Was ein Client selbst unter diesem Namen schickt, gilt nie.
    delete request.headers[UPGRADE_ID_HEADER];
    try {
      const ip = clientAddress(
        request.headers["x-forwarded-for"],
        request.socket.remoteAddress,
        proxyHops,
      );
      const versuch = await attemptConnection(
        `collab-ip:${ip}`,
        limits.maxAttemptsPerIp,
        ATTEMPT_WINDOW_SEC,
      );
      if (!versuch.allowed) {
        if (versuch.firstRejection) {
          log.warn(
            { ip, grund: COLLAB_REJECT_REASON.rateLimited },
            "Collab-Verbindung vor dem Handshake abgewiesen",
          );
        }
        refuseUpgrade(
          upgradeSocket,
          429,
          "Zu viele Verbindungsversuche",
          ATTEMPT_WINDOW_SEC,
        );
        return Promise.reject();
      }
      // Belegen erst nach dem letzten await: zwischen Pruefen und
      // Belegen kaeme sonst eine gleichzeitige Anfrage am selben Platz
      // vorbei.
      const platz = sockets.tryAcquire(ip);
      if (!platz.ok && platz.grund === "instanz") {
        if (Date.now() - lastFullLogAt > 10_000) {
          lastFullLogAt = Date.now();
          log.warn(
            { ip, grenze: limits.maxConnections },
            "Collab-Server voll, Verbindung abgewiesen",
          );
        }
        refuseUpgrade(upgradeSocket, 503, "Collab-Server ausgelastet", 5);
        return Promise.reject();
      }
      if (!platz.ok) {
        if (Date.now() - lastAddressFullLogAt > 10_000) {
          lastAddressFullLogAt = Date.now();
          log.warn(
            {
              ip,
              grund: COLLAB_REJECT_REASON.tooManyConnections,
              grenze: limits.maxConnectionsPerIp,
            },
            "Collab-Verbindung vor dem Handshake abgewiesen",
          );
        }
        refuseUpgrade(upgradeSocket, 429, "Zu viele offene Verbindungen", 10);
        return Promise.reject();
      }
      // Hat der Client waehrend der Pruefung aufgegeben, ist "close"
      // schon vorbei und kaeme fuer diesen Platz nie mehr: sofort
      // freigeben, sonst fehlte er der Instanz bis zum Neustart.
      if (upgradeSocket.destroyed) {
        platz.release();
        return Promise.reject();
      }
      // Anmeldefrist: wer bis dahin kein gueltiges Ticket gezeigt hat,
      // gibt seinen Platz wieder her (UNAUTHENTICATED_TIMEOUT_MS).
      // onAuthenticate beendet sie ueber die Kennung in den Kopfzeilen.
      const upgradeId = randomUUID();
      request.headers[UPGRADE_ID_HEADER] = upgradeId;
      authDeadlines.start(upgradeId, () => upgradeSocket.destroy());
      // "close" kommt fuer jeden Socket genau einmal, ob das Upgrade
      // gelingt oder nicht; die Freigabe wirkt ohnehin nur einmal.
      upgradeSocket.once("close", () => {
        authDeadlines.settle(upgradeId);
        platz.release();
      });
    } catch (e) {
      // Ein Fehler in der Pruefung selbst soll niemanden aussperren und
      // den Prozess nicht beenden (siehe oben): durchlassen und melden.
      log.warn({ err: e }, "Verbindungsgrenze nicht geprueft");
    }
  },

  async onAuthenticate(data) {
    const pageId = data.documentName;
    const ticket = await verifyTicket(data.token, pageId);

    const versuch = await attemptConnection(
      `collab-user:${ticket.userId}`,
      limits.maxAttemptsPerUser,
      ATTEMPT_WINDOW_SEC,
    );
    if (!versuch.allowed) {
      if (versuch.firstRejection) {
        log.warn(
          {
            userId: ticket.userId,
            pageId,
            grund: COLLAB_REJECT_REASON.rateLimited,
          },
          "Collab-Verbindung abgewiesen",
        );
      }
      throw limitRejection(COLLAB_REJECT_REASON.rateLimited);
    }

    const slot = slotKey(data.socketId, pageId);
    if (
      !userSlots.tryReserve(
        slot,
        ticket.userId,
        establishedConnections(ticket.userId),
      )
    ) {
      log.warn(
        {
          userId: ticket.userId,
          pageId,
          grund: COLLAB_REJECT_REASON.tooManyConnections,
          grenze: limits.maxConnectionsPerUser,
        },
        "Collab-Verbindung abgewiesen",
      );
      throw limitRejection(COLLAB_REJECT_REASON.tooManyConnections);
    }

    try {
      const { readOnly } = await checkTicketAccess(ticket, pageId);
      // Verbraucht wird erst, wenn alles andere passt: eine Anmeldung,
      // die an einer Grenze oder am Zugriff scheitert, hat nichts
      // eingeloest. Zwei gleichzeitige Anmeldungen mit demselben Ticket
      // entscheidet SET NX — genau eine kommt durch.
      if (!(await consumeTicket(ticket.jti, ticket.ttlSec))) {
        log.warn(
          {
            userId: ticket.userId,
            pageId,
            grund: COLLAB_REJECT_REASON.ticketUsed,
          },
          "Collab-Verbindung abgewiesen",
        );
        throw limitRejection(COLLAB_REJECT_REASON.ticketUsed);
      }
      data.connectionConfig.readOnly = readOnly;
    } catch (e) {
      userSlots.settle(slot);
      throw e;
    }
    // Angemeldet: die Anmeldefrist des Sockets endet. Ab jetzt gilt nur
    // noch das Leerlauf-Timeout von Hocuspocus.
    const upgradeId = data.requestHeaders.get(UPGRADE_ID_HEADER);
    if (upgradeId) authDeadlines.settle(upgradeId);
    // Token-Version und Sitzung wandern in den Kontext, damit die
    // wiederkehrende Prüfung sie ohne neues Ticket vergleichen kann.
    return {
      userId: ticket.userId,
      tokenVersion: ticket.tokenVersion,
      sessionId: ticket.sessionId,
    };
  },

  // Die Verbindung steht und zaehlt ab jetzt ueber Hocuspocus selbst
  // (establishedConnections); die Vormerkung aus onAuthenticate endet.
  async connected(data) {
    userSlots.settle(slotKey(data.socketId, data.documentName));
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
    // Marke und Stand im selben synchronen Schritt: so weiss ein
    // wartender Doc-Reset, ob dieser Lauf seinen Austausch traegt. Die
    // Marke gehoert zu genau diesem Dokument, nicht zur Seite: ein nach
    // dem Entladen neu geladenes Dokument traegt einen ungespeicherten
    // Austausch nicht (siehe ./store-watch).
    const marke = storeWatch.current(data.document);
    const state = Buffer.from(Y.encodeStateAsUpdate(data.document));

    // Der Yjs-Zustand zuerst und für sich. Er ist das Einzige, woraus
    // onLoadDocument das Dokument wieder aufbaut; alles Weitere (Inhalt
    // für Suche und Export, Erwähnungen) lässt sich aus ihm neu ableiten.
    // Hinge er an den Schritten danach, ginge bei deren Fehler der Text
    // verloren: Hocuspocus behält das Dokument dann nur im Speicher, und
    // war das der Lauf beim Trennen der letzten Verbindung, stösst nichts
    // einen weiteren an — der nächste Neustart verwirft ihn.
    try {
      await prisma.collabDocument.upsert({
        where: { pageId },
        create: { pageId, state },
        update: { state },
      });
    } catch (e) {
      storeWatch.failed(data.document, marke, e);
      throw e;
    }
    storeWatch.stored(data.document, marke);

    const json = TiptapTransformer.fromYdoc(data.document, COLLAB_FIELD);
    const textContent = extractText(json);
    const editorId =
      (data.lastContext?.userId as string | undefined) ?? undefined;

    // Alten Inhalt VOR dem Update lesen (für den Mention-Diff).
    const before = await prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true, spaceId: true, title: true },
    });

    // Neue Erwähnungen werden gegen genau diesen alten Stand bestimmt, und
    // ihre Zeilen entstehen in DERSELBEN Transaktion, die ihn überschreibt.
    // Liefen sie erst danach, wäre die Grundlage des Diffs schon weg: endet
    // der Prozess dazwischen oder scheitert die Ermittlung, fände der
    // nächste Lauf dieselbe Erwähnung nicht mehr als neu, und die
    // Erwähnten bekämen dauerhaft weder Glocke noch Mail. Deshalb darf die
    // Ermittlung hier den Rest des Speicherlaufs kippen, wie es das Lesen
    // von `before` schon tut: der Yjs-Zustand steht oben schon fest,
    // Page.content bleibt auf dem alten Stand, und der nächste Lauf
    // rechnet gegen genau diesen noch einmal. Die Mail verschickt der
    // Dispatcher aus diesen Zeilen, also erst nach dem Commit und nur
    // einmal.
    const mentioned = before
      ? await newMentionRecipients(
          pageId,
          before.spaceId,
          before.content,
          json,
          editorId,
        )
      : [];

    await prisma.$transaction([
      prisma.page.update({
        where: { id: pageId },
        data: {
          content: json,
          textContent,
          ...(editorId ? { lastEditedById: editorId } : {}),
        },
      }),
      ...(mentioned.length > 0
        ? [
            prisma.notification.createMany({
              data: mentioned.map((userId) => ({
                userId,
                actorId: editorId,
                type: "MENTION" as const,
                pageId,
              })),
            }),
          ]
        : []),
    ]);

    // Glocke der erwähnten Personen sofort aktualisieren — erst nach dem
    // Commit, sonst holte sie eine Zeile ab, die es noch nicht gibt.
    await Promise.all(
      mentioned.map((userId) =>
        redis
          .publish(`${NOTIFY_CHANNEL_PREFIX}${userId}`, "1")
          .catch(() => undefined),
      ),
    );

    // Die beiden Folgeschritte dürfen den Speicherlauf nicht kippen, also
    // wird ihr Fehler nur gemeldet. Dann muss die Meldung aber tragen:
    // ohne pageId und editorId liesse sich nachträglich nicht sagen,
    // welcher Seite die Suche oder die Backlinks fehlen, und `String(e)`
    // warf den Stack weg — der Logger serialisiert einen Error unter
    // `err` samt Stack selbst.
    if (before) {
      await syncWikiLinks(pageId, before.spaceId, json).catch((e) =>
        log.warn({ err: e, pageId, editorId }, "wikiLink sync fehlgeschlagen"),
      );
      // Scheitert es, bleibt die Seite in AiIndexQueue, und der KI-Index
      // (./ai-indexer) holt sie im naechsten Lauf nach. Ohne skipLocked:
      // haelt der Job die Seite gerade, wartet der Speicherlauf kurz.
      // textContent liest indexPageChunks selbst unter der Zeilensperre.
      await indexPageChunks(pageId, { chunk: chunkForAiIndex }).catch((e) =>
        log.warn({ err: e, pageId, editorId }, "chunk indexing fehlgeschlagen"),
      );
    }

    if (await shouldSnapshot(pageId)) {
      try {
        await prisma.pageVersion.create({
          data: {
            pageId,
            title: before?.title ?? "Untitled",
            content: json,
            textContent,
            authorId: editorId,
          },
        });
      } catch (e) {
        // Die Drossel ist schon belegt, der Snapshot aber nicht
        // geschrieben. Ohne diese Freigabe bliebe das Zeitfenster
        // verbraucht: zwei Minuten lang lieferte shouldSnapshot für
        // diese Seite false, und die Änderungen dieses Fensters
        // fehlten dauerhaft in der Versionsgeschichte.
        await releaseSnapshot(pageId);
        throw e;
      }
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
 * Bestimmt, wer eine MENTION-Benachrichtigung bekommt: Nutzer, die im
 * Vergleich zum vorherigen Stand NEU erwähnt wurden, die den Space
 * betreten und diese Seite auch öffnen dürfen und zu dieser Seite noch
 * keine ungelesene Erwähnung haben.
 *
 * Liest nur. Die Zeilen legt `onStoreDocument` in derselben Transaktion
 * an, die den Vergleichsstand überschreibt (Begründung dort).
 *
 * Die Mail dazu verschickt der Dispatcher (siehe ./mail-dispatcher):
 * er kennt das Sammelfenster, den Tagesdigest und
 * `User.emailNotifications`. Beim Speichern entsteht nur die Zeile —
 * zwei Versandwege nebeneinander hiessen zwei Mails pro Erwähnung.
 */
async function newMentionRecipients(
  pageId: string,
  spaceId: string,
  oldContent: unknown,
  newContent: unknown,
  actorId: string | undefined,
): Promise<string[]> {
  const previous = new Set(extractMentionIds(oldContent));
  const added = extractMentionIds(newContent).filter(
    (id) => !previous.has(id) && id !== actorId,
  );
  if (added.length === 0) return [];

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
  if (reachable.length === 0) return [];

  // Eine noch ungelesene Erwähnung auf dieser Seite genügt: die Glocke
  // führt schon dorthin, eine zweite Zeile hiesse eine zweite Mail.
  const open = await prisma.notification.findMany({
    where: {
      userId: { in: reachable },
      pageId,
      type: "MENTION",
      readAt: null,
    },
    select: { userId: true },
  });
  const alreadyOpen = new Set(open.map((n) => n.userId));
  return reachable.filter((userId) => !alreadyOpen.has(userId));
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
 * Inhalt fuer einen Doc-Reset.
 *
 * Mit versionId (heutige Web-App) der Inhalt genau dieser Version.
 * Frueher las der Server `Page.content` und brach ab, wenn inzwischen
 * wieder ein CollabDocument da war: dann lag zwischen Wiederherstellen
 * und Nachricht ein Speicherlauf, der `Page.content` mit dem alten Stand
 * ueberschrieben hatte. Das war richtig erkannt, aber nicht zu beheben
 * — der richtige Stand stand nirgends mehr, auch ein zweiter Versuch
 * haette ihn nicht gefunden, und die Person sah trotzdem Erfolg. Die
 * Version hat ihn noch.
 */
async function loadResetContent(
  message: DocResetMessage,
): Promise<ResetContent> {
  const { pageId, versionId } = message;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { content: true, deletedAt: true },
  });
  if (!page || page.deletedAt) {
    return { kind: "abbruch", outcome: "seite-fehlt" };
  }

  if (versionId) {
    const version = await prisma.pageVersion.findFirst({
      where: { id: versionId, pageId },
      select: { content: true },
    });
    // Eine Version ohne Inhalt hat auch die Web-App nicht nach
    // Page.content geschrieben; das laufende Dokument bleibt dann, wie es
    // ist, und die Person bekommt den Hinweis.
    if (!version?.content) {
      return { kind: "abbruch", outcome: "version-fehlt" };
    }
    return { kind: "inhalt", content: version.content };
  }

  // Aeltere Web-App ohne versionId (nur waehrend eines rollierenden
  // Deploys): der fruehere Weg. Jene Web-App loescht die
  // CollabDocument-Zeile in derselben Transaktion, in der sie
  // `Page.content` wiederherstellt; ist wieder eine da, hat ein
  // Speicherlauf `Page.content` schon mit dem alten Stand ueberschrieben,
  // und ein Reset darauf setzte das Dokument genau auf diesen zurueck.
  // Gefragt wird, bevor der Austausch das Dokument laedt (das legt die
  // Zeile wieder an; siehe ./doc-reset).
  const gespeichert = await prisma.collabDocument.findUnique({
    where: { pageId },
    select: { pageId: true },
  });
  if (gespeichert) {
    log.warn(
      { pageId },
      "Wiederherstellung nicht übernommen: Dokument wurde zwischenzeitlich gespeichert",
    );
    return { kind: "abbruch", outcome: "ueberschrieben" };
  }
  if (!page.content) return { kind: "abbruch", outcome: "seite-fehlt" };
  return { kind: "inhalt", content: page.content };
}

/**
 * Ersetzt den Inhalt eines Yjs-Dokuments auf seiner bestehenden Linie
 * und wartet, bis der neue Stand gespeichert ist.
 *
 * Ohne das bliebe ein geöffnetes Dokument im Speicher unverändert: die
 * Web-App schreibt beim Wiederherstellen nur `Page.content`, der nächste
 * `onStoreDocument` schriebe den alten Speicherstand zurück — die
 * Wiederherstellung wäre still verpufft. Über eine Direktverbindung
 * gesetzt, ziehen offene Editoren den Stand sofort nach, und die
 * HA-Erweiterung trägt ihn zu den anderen Instanzen.
 *
 * Hält diese Instanz das Dokument nicht, lädt `openDirectConnection` es
 * über onLoadDocument aus CollabDocument — also die Linie, die auch jede
 * Kopie im Browser trägt. Aufgerufen wird das nur, wenn keine andere
 * Instanz es hält (siehe ./doc-reset). Gelöscht wird Eintrag für
 * Eintrag dieser Linie; eine alte Kopie, die später verbindet, bekommt
 * die Löschungen mit, statt den alten Inhalt zurückzubringen.
 *
 * Die Direktverbindung trägt die Person, die wiederhergestellt hat, als
 * Kontext: der Speicherlauf danach liest daraus `lastContext.userId` und
 * trägt sie als zuletzt bearbeitende Person und als Autor einer dabei
 * entstehenden Version ein. Neue Erwähnungen findet dieser Lauf in der
 * Regel nicht, weil `Page.content` schon den Inhalt der Version trägt.
 * Hat ein Speicherlauf des offenen Dokuments ihn dazwischen mit dem
 * alten Stand überschrieben, gelten Erwähnungen der Version, die dort
 * fehlten, als neu — wie bei jeder Änderung, die sie wieder einfügt.
 *
 * Das Trennen stösst den Speicherlauf sofort an. Gewartet wird nicht auf
 * das Trennen selbst, sondern auf den Speicherlauf genau dieses
 * Dokuments, der den Austausch trägt (Begründung in ./store-watch).
 * Scheitert er, wird das Dokument vorher entladen oder kommt er nicht
 * bis `deadline`, wirft diese Funktion, und ./doc-reset versucht es
 * erneut oder quittiert negativ. Halten Editoren das Dokument, bleibt es
 * dabei mit dem neuen Inhalt im Speicher; hielt nur die Direktverbindung
 * es, entlädt Hocuspocus es nach dem Trennen trotzdem, und CollabDocument
 * behält den alten Stand.
 *
 * Eine Wiederholung, die ein ANDERES Dokument vor sich hat als der
 * letzte Austausch (das alte wurde ungespeichert entladen und neu
 * geladen), spielt zuerst den ganzen Stand des alten ein und tauscht
 * erst dann aus. Ein Editor, der den ersten Austausch noch gesehen hat,
 * trägt dessen Einträge in seiner Browser-Kopie. Ein zweiter Austausch
 * ohne sie löschte sie nicht, und beim nächsten Verbinden stünde der
 * wiederhergestellte Inhalt doppelt da. So löscht der zweite Austausch
 * auch die Einträge des ersten, und jede Kopie wird mit ihm eins. Was
 * jemand in der Zwischenzeit getippt hat, ersetzt die Wiederherstellung,
 * wie bei jeder Wiederherstellung während einer Bearbeitung.
 *
 * `deadline` ist ein Zeitpunkt (Date.now), kein Zeitraum: das Laden
 * zählt mit, die Restzeit fürs Speichern wird erst unmittelbar vor dem
 * Warten berechnet. Die Quittung hängt nicht daran: ./doc-reset wartet
 * ohnehin nur bis zur Frist und quittiert dann negativ, auch wenn diese
 * Funktion noch lädt. Ist das Laden erst nach der Frist fertig, wird
 * trotzdem ausgetauscht. Ohne Austausch schriebe der Speicherlauf beim
 * Trennen den alten Stand nach CollabDocument, womöglich nachdem die
 * Web-App es im Rückfall gelöscht hat; der nächste Start zeigte dann den
 * alten Inhalt. Mit Austausch schreibt derselbe Lauf den
 * wiederhergestellten, auf der bestehenden Linie.
 */
/**
 * Das Dokument des letzten Austauschs je Doc-Reset, für die Wiederholung
 * (siehe applyResetContent). Schlüssel ist die Nachricht: ./doc-reset
 * reicht allen Versuchen dasselbe Objekt, und ist der Doc-Reset vorbei,
 * gibt die WeakMap das alte Dokument mit der Nachricht frei. Sein Stand
 * bleibt nach dem Entladen lesbar; Y.Doc.destroy() meldet nur ab.
 */
const letzterAustausch = new WeakMap<DocResetMessage, Y.Doc>();

async function applyResetContent(
  message: DocResetMessage,
  content: unknown,
  deadline: number,
): Promise<void> {
  const { pageId, actorId } = message;
  const seeded = TiptapTransformer.toYdoc(
    content,
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
  const connection = await server.hocuspocus.openDirectConnection(
    pageId,
    actorId ? { userId: actorId } : {},
  );
  const dokument = connection.document;
  let gespeichert: Promise<void> | undefined;
  try {
    if (!dokument) throw new Error("Direktverbindung ohne Dokument");
    const frueher = letzterAustausch.get(message);
    await connection.transact((doc: Y.Doc) => {
      // In derselben Transaktion wie der Austausch: kein Speicherlauf und
      // kein Editor sieht den alten Stand ohne die Löschungen danach.
      if (frueher && frueher !== doc) {
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(frueher));
      }
      const fragment = doc.getXmlFragment(COLLAB_FIELD);
      fragment.delete(0, fragment.length);
      fragment.insert(0, nodes);
    });
    letzterAustausch.set(message, dokument);
    gespeichert = storeWatch.expectStore(
      dokument,
      Math.max(0, deadline - Date.now()),
    );
  } finally {
    connection
      .disconnect()
      .catch((e: unknown) =>
        log.warn(
          { err: e, pageId },
          "Direktverbindung nach Doc-Reset nicht sauber getrennt",
        ),
      );
  }
  await gespeichert;
}

/**
 * Ablauf des Doc-Resets (wer ausfuehrt, Wiederholungen, Quittung) steht
 * in ./doc-reset; hier nur die Anbindung an Hocuspocus, Redis und die
 * Datenbank.
 */
const handleDocReset = createDocResetHandler({
  // Der Nonce-Lock stellt sicher, dass bei mehreren Instanzen GENAU EINE
  // das Dokument ersetzt und quittiert — sonst fügten zwei Instanzen ihre
  // Kopie ein und der Inhalt stünde doppelt da.
  claim: async (nonce) =>
    (await redis.set(
      `dokunc:doc-reset:${nonce}`,
      "1",
      "PX",
      60_000,
      "NX",
    )) === "OK",
  isLoadedHere: (pageId) =>
    server.hocuspocus.documents.has(pageId) ||
    server.hocuspocus.loadingDocuments.has(pageId),
  // Jede Instanz, die das Dokument hält, hat den Kanal der HA-Erweiterung
  // abonniert. NUMSUB zählt die Abonnenten über alle Instanzen; gefragt
  // wird nur, wenn diese Instanz das Dokument nicht hält.
  isLoadedElsewhere: async (pageId) => {
    const reply = (await redis.pubsub(
      "NUMSUB",
      `${haExtension.configuration.prefix}:${pageId}`,
    )) as [string, number | string];
    return Number(reply[1] ?? 0) > 0;
  },
  loadContent: loadResetContent,
  applyContent: applyResetContent,
  acknowledge: async (nonce, ack) => {
    const key = `${DOC_RESET_ACK_PREFIX}${nonce}`;
    const res = await redis
      .multi()
      .lpush(key, JSON.stringify(ack))
      .expire(key, DOC_RESET_ACK_TTL_SEC)
      .exec();
    if (!res) throw new Error("redis: multi abgebrochen");
    for (const [err] of res) if (err) throw err;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  log,
});

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
  // Schlüssel der geöffneten Dokumente — das sind Seiten-IDs.
  const openIds = [...server.hocuspocus.documents.keys()];
  if (openIds.length === 0) return 0;

  const pages = await prisma.page.findMany({
    where: {
      id: { in: openIds },
      OR: [{ id: pageId }, { accessRootId: pageId }],
    },
    select: { id: true, spaceId: true },
  });

  /**
   * Entscheidung je Seite und Person merken. Eine Person kann dieselbe
   * Seite in beliebig vielen Tabs offen haben, und jede dieser
   * Verbindungen führte sonst dieselben zwei Abfragen aus
   * (effectiveSpaceRole, canSeePage): die Last hinge an der Zahl der
   * Verbindungen statt an der Zahl der Personen.
   */
  const mayStay = new Map<string, Promise<boolean>>();
  const checkAccess = (id: string, spaceId: string, userId: string) => {
    const key = `${id}:${userId}`;
    let cached = mayStay.get(key);
    if (!cached) {
      cached = (async () => {
        const role = await effectiveSpaceRole(userId, spaceId);
        return !!role && (await canSeePage(id, userId, role));
      })();
      mayStay.set(key, cached);
    }
    return cached;
  };

  let closed = 0;
  for (const page of pages) {
    const doc = server.hocuspocus.documents.get(page.id);
    if (!doc) continue;
    for (const connection of doc.getConnections()) {
      const userId = (connection.context as { userId?: string } | null)?.userId;
      if (!userId) continue;
      if (await checkAccess(page.id, page.spaceId, userId)) continue;
      closeConnection(connection, "Zugriff auf diese Seite entzogen");
      closed += 1;
    }
  }
  return closed;
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

      // Geschützte Seite ohne Freigabe: die Entscheidung trifft dieselbe
      // Regel wie `canSeePage`, nur mit den oben gebündelt geladenen
      // Freigaben statt zwei Abfragen je Verbindung.
      const sichtbar = canSeePageWithGrant(
        role,
        page?.accessRootId,
        !!(
          page?.accessRootId &&
          grantedByRoot.get(page.accessRootId)?.has(ctx.userId as string)
        ),
      );

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
        !sichtbar ||
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
 * Eine Nachricht der Web-App lesen und ihre Form prüfen.
 *
 * Auf dem Kanal kommt nur Text an. Ein Cast auf den erwarteten Typ
 * behauptete die Form lediglich; die Prüfer aus dem gemeinsamen Paket
 * stehen neben den Typen, die auch die Web-App beim Senden verwendet.
 * Verworfen wird mit Log-Eintrag: still verworfen sähe eine Nachricht
 * einer abweichenden Fassung (rollierender Deploy) genauso aus wie eine,
 * die nie gesendet wurde — und Wiederherstellung oder Zugriffsentzug
 * blieben ohne Spur liegen.
 */
function readMessage<T>(
  channel: string,
  raw: string,
  isValid: (value: unknown) => value is T,
): T | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    log.warn({ err: e, channel }, "Redis-Nachricht verworfen: kein JSON");
    return null;
  }
  if (!isValid(value)) {
    // Gekürzt: wer auf dem Kanal senden kann, bestimmt die Länge.
    log.warn(
      { channel, raw: raw.slice(0, 200) },
      "Redis-Nachricht verworfen: unerwartete Form",
    );
    return null;
  }
  return value;
}

/**
 * Auf Wünsche der Web-App hören: Dokument neu aufbauen (Wiederherstellen
 * einer Version, mit Quittung) und Verbindungen nach einem
 * Zugriffsentzug trennen.
 */
function startDocResetListener(): void {
  const subscriber = redis.duplicate();
  subscriber.on("error", (e: Error) => log.warn({ err: e }, "redis-sub"));
  // Scheiterte das Abonnieren einmal, liefe der Prozess dauerhaft taub
  // weiter: keine Wiederherstellung erreichte mehr ein offenes Dokument,
  // und der seitenweise Zugriffsentzug bliebe bis zur nächsten
  // Minutenrunde liegen. Deshalb nach jedem Verbindungsaufbau erneut
  // abonnieren — "ready" kommt auch nach einem Wiederaufbau, und ein
  // zweites SUBSCRIBE auf denselben Kanal ist folgenlos.
  const subscribe = () => {
    subscriber
      .subscribe(DOC_RESET_CHANNEL, ACCESS_REVOKED_CHANNEL, PAGE_ACCESS_CHANNEL)
      .catch((e: unknown) => {
        log.warn({ err: e }, "Redis-Kanäle nicht abonniert");
      });
  };
  subscriber.on("ready", subscribe);
  // Der Client verbindet sich erst beim ersten Befehl (lazyConnect),
  // "ready" käme ohne diesen Aufruf also nie.
  subscribe();
  subscriber.on("message", async (channel: string, raw: string) => {
    try {
      if (channel === PAGE_ACCESS_CHANNEL) {
        const message = readMessage(channel, raw, isPageAccessMessage);
        if (!message) return;
        const { pageId } = message;
        const closed = await enforcePageAccess(pageId);
        if (closed > 0) {
          log.info({ pageId, closed }, "Verbindungen nach Zugriffsaenderung getrennt");
        }
        return;
      }
      if (channel === ACCESS_REVOKED_CHANNEL) {
        const message = readMessage(channel, raw, isAccessRevokedMessage);
        if (!message) return;
        const { userId, spaceId } = message;
        const closed = await disconnectUserFromSpace(userId, spaceId);
        if (closed > 0) {
          log.info({ userId, spaceId, closed }, "Collab-Verbindungen getrennt");
        }
        return;
      }
      const message = readMessage(channel, raw, isDocResetMessage);
      if (!message) return;
      await handleDocReset(message);
    } catch (e) {
      log.warn(
        { err: e, channel },
        "Redis-Nachricht konnte nicht verarbeitet werden",
      );
    }
  });
}

server
  .listen()
  .then(() => {
    log.info({ port: PORT }, "Hocuspocus läuft");
    // Mail-Versand von Benachrichtigungen (periodisch, Redis-gelockt).
    startMailDispatcher({ redis, log });
    // KI-Index: Chunks fuer Seiten aus allen Schreibwegen, Embeddings im
    // Hintergrund (periodisch, Redis-Sperre, siehe ./ai-indexer).
    startAiIndexer({ redis, log });
    startDocResetListener();
    setInterval(() => {
      void enforceRevocations().catch((e) =>
        log.warn({ err: e }, "Rechteprüfung fehlgeschlagen"),
      );
    }, REVOCATION_INTERVAL_MS).unref();
  })
  .catch((e) => {
    // Ohne diesen Zweig fehlt der Startfehler (belegter Port) im
    // strukturierten Log vollständig — Node beendete den Prozess wegen
    // der unbehandelten Rejection mit einer Rohausgabe auf stderr.
    // Kippt stattdessen der then-Block, steht "Hocuspocus läuft" schon
    // im Log, während Mailversand und Redis-Listener nie gestartet
    // sind: ein halb gestarteter Dienst ist nicht brauchbar, also
    // beenden wir genauso, wie es vorher unbemerkt geschah.
    log.error({ err: e, port: PORT }, "Collab-Server nicht gestartet");
    process.exit(1);
  });
