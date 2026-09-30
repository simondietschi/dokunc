import { spawn, type ChildProcess } from "node:child_process";
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
 * | 1–3    | frei (Reserve)                                             |
 * | 4      | collab-konfiguration.test.ts                               |
 * | 5      | collab-ausnahmen.test.ts (reserviert)                      |
 * | 6      | gruppe-loeschen.test.ts (reserviert, nur Abonnent)         |
 * | 7      | schema-version.test.ts                                     |
 * | 8      | collab-json-log.test.ts (reserviert)                       |
 * | 9      | collab-lesend.test.ts (reserviert)                         |
 * | 10     | collab-size-limits.test.ts                                 |
 * | 11     | page-updated-collab.test.ts                                |
 * | 12     | collab-limits.test.ts                                      |
 * | 13     | restore-version-collab.test.ts                             |
 * | 14     | restore-epoch.test.ts                                      |
 * | 15     | collab-redis-start.test.ts                                 |
 * | –      | Ausfalltests mit eigenem redis-server                      |
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
  redisDb: number;
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
  const redisUrl = redisUrlMitDb(opts.redisDb);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  if (opts.exklusiv && (await resetZuhoerer(redis)) > 0) {
    redis.disconnect();
    throw new Error(
      "An diesem Redis hoert schon ein Collab-Server auf den Reset-Kanal " +
        "(Pub/Sub gilt ueber alle Datenbanken). Den Pruefstand ohne " +
        "fremden Collab-Server laufen lassen.",
    );
  }
  if (opts.exklusiv) await redis.flushdb();
  await redis.set("dokunc:mail-dispatch:lock", "pruefstand", "PX", 300_000);
  const vorher = await resetZuhoerer(redis);

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
    },
  );
  child.stdout?.on("data", (d: Buffer) => (ausgabe += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (ausgabe += d.toString()));

  const stop = async () => {
    if (child.exitCode === null) {
      const beendet = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await Promise.race([beendet, new Promise((r) => setTimeout(r, 5_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await redis.del("dokunc:mail-dispatch:lock").catch(() => undefined);
    redis.disconnect();
  };

  // Bereit ist er, wenn er selbst gemeldet hat, auf welchem Port er
  // lauscht, und auf dem Reset-Kanal hoert: das abonniert er erst nach
  // dieser Zeile. Die Startzeile kommt nur von diesem Prozess; die Zahl
  // der Abonnenten dagegen zaehlt jeden Collab-Server an diesem Redis
  // (starten zwei zugleich, kann der Kanal des einen einen Moment nach
  // dem des anderen abonniert sein; Pruefstaende mit Doc-Reset starten
  // deshalb exklusiv).
  const ende = Date.now() + 30_000;
  let port: number | null;
  for (;;) {
    port = gemeldeterPort(ausgabe);
    if (port !== null && (await resetZuhoerer(redis)) > vorher) break;
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
    log: () => ausgabe,
    stop,
  };
}
