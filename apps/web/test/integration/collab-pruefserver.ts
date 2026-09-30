import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { DOC_RESET_CHANNEL } from "@dokunc/editor";

/**
 * Ein echter Collab-Server fuer Integrationstests: eigener Prozess
 * (apps/collab/src/server.ts wie unter `pnpm --filter @dokunc/collab
 * start`), eigener Port, eigene Redis-Datenbank.
 *
 * Den Port waehlt der Server selbst (COLLAB_PORT=0, das Betriebssystem
 * vergibt einen freien), und der Pruefstand liest ihn aus dessen
 * Startzeile. Frueher suchte der Pruefstand vorher einen freien Port aus
 * 3150 bis 3199; zwischen dieser Probe und dem listen() des Servers
 * vergingen Sekunden, und liefen zwei Integrationslaeufe auf einer
 * Maschine, bekamen beide denselben Port. Der zweite Server endete mit
 * EADDRINUSE, und weil Pub/Sub ueber alle Datenbanken gilt, sah der
 * Pruefstand trotzdem einen neuen Abonnenten des Reset-Kanals (den des
 * ersten) und meldete den fremden Server als den eigenen.
 *
 * Er arbeitet auf derselben Postgres-Datenbank wie die Tests. Damit sein
 * Mail-Versand dort nichts anfasst, belegt der Pruefstand dessen Sperre
 * fuer die Dauer des Laufs. Sein KI-Index ist abgeschaltet
 * (AI_INDEX_INTERVAL_S=0), damit er keine Seiten anderer Tests indexiert.
 *
 * Belegung der Redis-Datenbanken (eine je Testdatei; liegengebliebene
 * Schluessel eines abgebrochenen Laufs, etwa Versuchszaehler oder
 * verbrauchte Tickets, sollen keine fremde Datei treffen):
 *
 * | DB     | Nutzer                                                     |
 * |--------|------------------------------------------------------------|
 * | 0      | Entwicklung, E2E                                           |
 * | 1–2    | frei (Reserve)                                             |
 * | 3      | collab-zusammenfuehren.test.ts                             |
 * | 4      | collab-konfiguration.test.ts                               |
 * | 5      | collab-ausnahmen.test.ts (reserviert)                      |
 * | 6      | gruppe-loeschen.test.ts (reserviert, nur Abonnent)         |
 * | 7      | schema-version.test.ts                                     |
 * | 8      | collab-json-log.test.ts (reserviert)                       |
 * | 9      | collab-lesend.test.ts                                      |
 * | 10     | collab-size-limits.test.ts                                 |
 * | 11     | page-updated-collab.test.ts                                |
 * | 12     | collab-limits.test.ts                                      |
 * | 13     | restore-version-collab.test.ts                             |
 * | 14     | restore-epoch.test.ts                                      |
 * | 15     | collab-redis-start.test.ts                                 |
 * | –      | collab-chaos.test.ts: eigene redis-server (./redis-privat)  |
 *
 * Pub/Sub gilt ueber alle Datenbanken: wer in einem Test mitliest,
 * filtert auf die IDs seines eigenen Falls.
 */

const COLLAB_DIR = fileURLToPath(new URL("../../../collab", import.meta.url));

export type Pruefserver = {
  /** ws://-Adresse fuer den Provider. */
  url: string;
  port: number;
  /** REDIS_URL des Servers (eigene Datenbank). */
  redisUrl: string;
  /** Verbindung zu dieser Redis-Datenbank. */
  redis: Redis;
  /** Prozess-ID des gestarteten Prozesses (tsx; der Server ist sein Kind). */
  pid: number;
  /** Laeuft der Prozess noch? Endet der Server, endet tsx mit ihm. */
  laeuft(): boolean;
  /** Bisherige Ausgabe des Servers, fuer Fehlermeldungen. */
  log(): string;
  stop(): Promise<void>;
};

export function redisUrlMitDb(db: number): string {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  url.pathname = `/${db}`;
  return url.toString();
}

/**
 * Port aus der Startzeile "Hocuspocus läuft" des Servers (pino, eine
 * JSON-Zeile je Eintrag); null, solange sie fehlt.
 */
function gemeldeterPort(ausgabe: string): number | null {
  for (const zeile of ausgabe.split("\n")) {
    if (!zeile.includes("Hocuspocus läuft")) continue;
    try {
      const { msg, port } = JSON.parse(zeile) as {
        msg?: unknown;
        port?: unknown;
      };
      if (msg === "Hocuspocus läuft" && typeof port === "number" && port > 0) {
        return port;
      }
    } catch {
      /* unvollstaendige Zeile, kommt im naechsten Takt ganz */
    }
  }
  return null;
}

async function resetZuhoerer(redis: Redis): Promise<number> {
  const [, n] = (await redis.pubsub("NUMSUB", DOC_RESET_CHANNEL)) as [
    string,
    number,
  ];
  return Number(n);
}

export async function startePruefserver(opts: {
  /** Redis-Datenbank (Tabelle oben) am Redis aus REDIS_URL. */
  redisDb?: number;
  /**
   * Stattdessen ein ganzes eigenes Redis (./redis-privat), etwa fuer
   * Ausfalltests. Server und Pruefstand nutzen dann diese Adresse.
   */
  redisUrl?: string;
  /** Secret, mit dem der Test die Tickets signiert. */
  appSecret: string;
  env?: Record<string, string>;
  /**
   * Verlangen, dass sonst kein Collab-Server auf den Reset-Kanal hoert.
   * Pub/Sub gilt in Redis ueber alle Datenbanken hinweg; ein fremder
   * Server bekaeme eine Bitte um Austausch mit und fuehrte sie ebenfalls
   * aus. Leert ausserdem vor dem Start die eigene Datenbank (FLUSHDB):
   * Schluessel eines abgebrochenen frueheren Laufs (Versuchszaehler,
   * verbrauchte Tickets) sollen diesen Lauf nicht beeinflussen.
   */
  exklusiv?: boolean;
  /**
   * Fester Port, etwa fuer einen Neustart auf demselben Port (Provider
   * verbinden dann von selbst neu). Ohne Angabe waehlt ihn der Server.
   */
  port?: number;
}): Promise<Pruefserver> {
  if (opts.redisUrl === undefined && opts.redisDb === undefined) {
    throw new Error("startePruefserver braucht redisDb oder redisUrl");
  }
  const redisUrl = opts.redisUrl ?? redisUrlMitDb(opts.redisDb!);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  // Ausfalltests halten das Redis an; ohne Handler schriebe ioredis jeden
  // Verbindungsfehler als "Unhandled error event" auf stderr.
  redis.on("error", () => undefined);
  // Ein eben beendeter Server kann noch einen Moment als Abonnent zaehlen,
  // bis Redis das Ende seiner Verbindung verarbeitet hat.
  const exklusivBis = Date.now() + 3_000;
  while (
    opts.exklusiv &&
    (await resetZuhoerer(redis)) > 0 &&
    Date.now() < exklusivBis
  ) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (opts.exklusiv && (await resetZuhoerer(redis)) > 0) {
    redis.disconnect();
    throw new Error(
      "An diesem Redis hoert schon ein Collab-Server auf den Reset-Kanal " +
        "(Pub/Sub gilt ueber alle Datenbanken). Den Pruefstand ohne " +
        "fremden Collab-Server laufen lassen.",
    );
  }
  if (opts.exklusiv) await redis.flushdb();
  // Laenger als jede Testdatei: der Ausfalltest laeuft einige Minuten.
  await redis.set("dokunc:mail-dispatch:lock", "pruefstand", "PX", 1_800_000);

  let ausgabe = "";
  const child: ChildProcess = spawn(
    join(COLLAB_DIR, "node_modules/.bin/tsx"),
    ["src/server.ts"],
    {
      cwd: COLLAB_DIR,
      env: {
        ...process.env,
        COLLAB_PORT: String(opts.port ?? 0),
        REDIS_URL: redisUrl,
        APP_SECRET: opts.appSecret,
        LOG_LEVEL: "info",
        AI_INDEX_INTERVAL_S: "0",
        ...opts.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Eigene Prozessgruppe: tsx startet den Server als weiteren
      // Prozess. Haengt er beim Beenden (Hocuspocus wartet, bis alle
      // Dokumente entladen sind, und ein Dokument, das sich nicht
      // speichern laesst, bleibt im Speicher), traefe ein SIGKILL nur tsx,
      // und der Server liefe verwaist weiter, am Reset-Kanal desselben
      // Redis. Deshalb geht SIGKILL an die ganze Gruppe.
      detached: true,
    },
  );
  child.stdout?.on("data", (d: Buffer) => (ausgabe += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (ausgabe += d.toString()));

  const warteAufEnde = (ms: number) =>
    Promise.race([
      new Promise((r) => child.once("exit", r)),
      new Promise((r) => setTimeout(r, ms)),
    ]);
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const beendet = warteAufEnde(5_000);
      child.kill("SIGTERM");
      await beendet;
    }
    try {
      // Auch nach dem Ende von tsx: ein uebrig gebliebener Server.
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      /* Gruppe schon leer */
    }
    if (child.exitCode === null && child.signalCode === null) {
      await warteAufEnde(5_000);
    }
    await redis.del("dokunc:mail-dispatch:lock").catch(() => undefined);
    redis.disconnect();
  };

  // Bereit ist er, wenn er selbst gemeldet hat, auf welchem Port er
  // lauscht, und auf dem Reset-Kanal hoert: das abonniert er erst nach
  // dieser Zeile. Ob gerade DIESER Server hoert, zeigt eine Probe auf
  // dem Kanal: eine Nachricht, die er als "unerwartete Form" samt Inhalt
  // ins eigene Log schreibt. Die Zahl der Abonnenten zaehlte dagegen
  // jeden Collab-Server an diesem Redis, auch einen, der eben beendet
  // wurde und noch einen Moment mitzaehlt. Andere Server an diesem Redis
  // schreiben die Probe ebenso als Warnung ins Log.
  const marke = `bereit-${randomUUID()}`;
  const probe = JSON.stringify({ pruefstand: marke });
  const ende = Date.now() + 30_000;
  let port: number | null;
  for (;;) {
    port = gemeldeterPort(ausgabe);
    if (port !== null && ausgabe.includes(marke)) break;
    if (port !== null) {
      await redis.publish(DOC_RESET_CHANNEL, probe).catch(() => undefined);
    }
    if (child.exitCode !== null || Date.now() > ende) {
      await stop();
      throw new Error(`Collab-Server nicht gestartet:\n${ausgabe}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    url: `ws://127.0.0.1:${port}`,
    port,
    redisUrl,
    redis,
    pid: child.pid!,
    laeuft: () => child.exitCode === null && child.signalCode === null,
    log: () => ausgabe,
    stop,
  };
}
