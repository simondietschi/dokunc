import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { DOC_RESET_CHANNEL } from "@dokunc/editor";

/**
 * Ein echter Collab-Server fuer Integrationstests: eigener Prozess
 * (apps/collab/src/server.ts wie unter `pnpm --filter @dokunc/collab
 * start`), eigener Port aus 3150 bis 3199, eigene Redis-Datenbank.
 *
 * Er arbeitet auf derselben Postgres-Datenbank wie die Tests. Damit sein
 * Mail-Versand dort nichts anfasst, belegt der Pruefstand dessen Sperre
 * fuer die Dauer des Laufs. Sein KI-Index ist abgeschaltet
 * (AI_INDEX_INTERVAL_S=0), damit er keine Seiten anderer Tests indexiert.
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

async function freierPort(): Promise<number> {
  for (let port = 3150; port <= 3199; port += 1) {
    const frei = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (frei) return port;
  }
  throw new Error("Kein freier Port zwischen 3150 und 3199");
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
   * aus.
   */
  exklusiv?: boolean;
  /**
   * Fester Port, etwa fuer einen Neustart auf demselben Port (Provider
   * verbinden dann von selbst neu). Ohne Angabe der erste freie aus 3150
   * bis 3199.
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
  await redis.set("dokunc:mail-dispatch:lock", "pruefstand", "PX", 300_000);
  const vorher = await resetZuhoerer(redis);

  const port = opts.port ?? (await freierPort());
  let ausgabe = "";
  const child: ChildProcess = spawn(
    join(COLLAB_DIR, "node_modules/.bin/tsx"),
    ["src/server.ts"],
    {
      cwd: COLLAB_DIR,
      env: {
        ...process.env,
        COLLAB_PORT: String(port),
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

  // Bereit ist er, wenn er auf dem Reset-Kanal hoert: das abonniert er
  // erst, nachdem der Port offen ist.
  const ende = Date.now() + 30_000;
  while ((await resetZuhoerer(redis)) <= vorher) {
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
