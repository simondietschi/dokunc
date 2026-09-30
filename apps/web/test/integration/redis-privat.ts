import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "ioredis";

/**
 * Ein eigener redis-server fuer Ausfalltests (collab-chaos.test.ts).
 *
 * Anhalten, Neustarten und "voll" lassen sich am gemeinsamen Redis der
 * Tests nicht nachstellen: der Dienst-Container der CI und das Redis der
 * Entwicklung gehoeren nicht dem Test, und CONFIG SET maxmemory traefe
 * dort alle anderen. Eine TCP-Weiche (./redis-weiche) kann Redis weg
 * sein lassen, aber nicht voll. Also ein eigener Prozess je Fall, mit
 * Passwort wie im Compose-Stapel, AOF mit fsync bei jedem Schreiben (ein
 * Neustart verliert nichts) und ohne Verdraengung (voll heisst: jeder
 * schreibende Befehl scheitert mit OOM).
 *
 * Die Adresse (`url`, `port`) bleibt vom Start bis `beenden` dieselbe
 * und belegt: sie gehoert einem Vorbau in diesem Prozess, der jede
 * Verbindung zum gerade laufenden redis-server durchreicht; redis-server
 * selbst bekommt bei jedem Start einen frischen Port. Hoerte er selbst auf
 * der Adresse, waere ihr Port waehrend eines Ausfalls (bis 30 s) frei: ein
 * anderer Prozess auf demselben Rechner, etwa ein paralleler Testlauf,
 * koennte ihn nehmen, und der Neustart scheiterte, oder die Collab-Server
 * verbaenden sich mit einem fremden Redis. Solange redis-server nicht
 * laeuft, setzt der Vorbau jede Verbindung sofort zurueck (fuer ioredis
 * wie ein abgewiesener Verbindungsversuch); durchgereicht wird nur zu
 * einem redis-server, der mit dem eigenen Passwort geantwortet hat.
 *
 * Braucht redis-server 7 oder neuer im PATH (der Collab-Server nutzt
 * EXPIRE ... NX). Die CI installiert es im Job e2e; lokal ueberspringt
 * collab-chaos.test.ts sich ohne, mit Hinweis.
 */

export type EigenesRedis = {
  /** REDIS_URL mit Passwort; gilt bis `beenden`, auch ueber Neustarts. */
  url: string;
  /** Port dieser Adresse (der Vorbau, nicht redis-server). */
  port: number;
  /** SIGTERM, wartet auf das Ende (AOF ist geschrieben). */
  anhalten(): Promise<void>;
  /** Gleiche Adresse, gleiches Verzeichnis; wartet, bis PING antwortet. */
  starten(): Promise<void>;
  /** anhalten und starten, wie `docker compose restart redis`. */
  neuStarten(): Promise<void>;
  /** CONFIG SET maxmemory 1 (voll) bzw. 0 (ohne Grenze). */
  voll(an: boolean): Promise<void>;
  /** Anhalten und das Verzeichnis loeschen. */
  beenden(): Promise<void>;
  /** Bisherige Ausgabe des Servers, fuer Fehlermeldungen. */
  log(): string;
};

/** Hauptversion des redis-server im PATH, null ohne. */
export function redisServerVersion(): number | null {
  const r = spawnSync("redis-server", ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const m = /v=(\d+)\./.exec(r.stdout);
  return m ? Number(m[1]) : null;
}

export function redisServerVorhanden(): boolean {
  const v = redisServerVersion();
  return v !== null && v >= 7;
}

async function freierPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const adresse = probe.address();
      probe.close(() =>
        typeof adresse === "object" && adresse
          ? resolve(adresse.port)
          : reject(new Error("Kein Port")),
      );
    });
  });
}

/**
 * Antwortet unter `url` ein Redis mit PONG? Jede Probe hat eine eigene
 * Frist: ein fremder Prozess auf dem Port nimmt die Verbindung vielleicht
 * an und antwortet nie.
 */
async function antwortet(
  url: string,
  bisMs: number,
  beendet: () => boolean,
): Promise<boolean> {
  const ende = Date.now() + bisMs;
  while (Date.now() < ende && !beendet()) {
    const c = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
    });
    c.on("error", () => undefined);
    try {
      await c.connect();
      if ((await c.ping()) === "PONG") return true;
    } catch {
      /* noch nicht da */
    } finally {
      c.disconnect();
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/**
 * Der Vorbau: haelt seinen Port, reicht zu `ziel` durch und setzt ohne
 * Ziel jede Verbindung sofort zurueck.
 */
async function starteVorbau() {
  let ziel: number | null = null;
  const offen = new Set<Socket>();
  const merke = (s: Socket) => {
    offen.add(s);
    s.on("close", () => offen.delete(s));
  };
  const server = createServer((client) => {
    merke(client);
    client.on("error", () => undefined);
    if (ziel === null) {
      client.resetAndDestroy();
      return;
    }
    const redis = connect(ziel, "127.0.0.1");
    merke(redis);
    redis.on("error", () => {
      if (!client.destroyed) client.resetAndDestroy();
    });
    client.on("close", () => redis.destroy());
    redis.on("close", () => client.destroy());
    client.pipe(redis).pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") {
    throw new Error("Vorbau ohne Port");
  }
  return {
    port: adresse.port,
    /** Port des laufenden redis-server; null, solange keiner laeuft. */
    ziel(port: number | null) {
      ziel = port;
    },
    async schliessen() {
      ziel = null;
      for (const s of offen) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

export async function starteEigenesRedis(): Promise<EigenesRedis> {
  const verzeichnis = await mkdtemp(join(tmpdir(), "dokunc-redis-"));
  const passwort = randomBytes(12).toString("hex");
  let ausgabe = "";
  let prozess: ChildProcess | null = null;
  const vorbau = await starteVorbau();

  const urlAuf = (port: number) => `redis://:${passwort}@127.0.0.1:${port}/0`;
  const url = urlAuf(vorbau.port);
  const args = (port: number) => [
    "--port",
    String(port),
    "--bind",
    "127.0.0.1",
    "--requirepass",
    passwort,
    "--appendonly",
    "yes",
    "--appendfsync",
    "always",
    "--save",
    "",
    "--dir",
    verzeichnis,
    "--maxmemory-policy",
    "noeviction",
  ];

  async function starteAuf(port: number): Promise<void> {
    const p = spawn("redis-server", args(port), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    prozess = p;
    p.stdout?.on("data", (d: Buffer) => (ausgabe += d.toString()));
    p.stderr?.on("data", (d: Buffer) => (ausgabe += d.toString()));
    const beendet = () => p.exitCode !== null || p.signalCode !== null;
    if (!(await antwortet(urlAuf(port), 10_000, beendet))) {
      p.kill("SIGKILL");
      prozess = null;
      throw new Error(`redis-server nicht gestartet:\n${ausgabe}`);
    }
  }

  // Der Port ist frei, wenn die Probe ihn bekommt; belegt ihn ein anderer
  // bis zum Start, endet redis-server sofort (oder ein fremdes Redis
  // lehnt das Passwort ab), und es geht mit dem naechsten weiter. Der
  // Vorbau reicht erst danach durch.
  async function starten(): Promise<void> {
    for (let versuch = 1; ; versuch += 1) {
      const port = await freierPort();
      try {
        await starteAuf(port);
        vorbau.ziel(port);
        return;
      } catch (e) {
        if (versuch >= 5) throw e;
      }
    }
  }

  async function anhalten(): Promise<void> {
    vorbau.ziel(null);
    const p = prozess;
    if (!p || p.exitCode !== null || p.signalCode !== null) return;
    const beendet = new Promise((r) => p.once("exit", r));
    p.kill("SIGTERM");
    await Promise.race([beendet, new Promise((r) => setTimeout(r, 10_000))]);
    if (p.exitCode === null && p.signalCode === null) {
      p.kill("SIGKILL");
      await beendet;
    }
    prozess = null;
  }

  try {
    await starten();
  } catch (e) {
    await vorbau.schliessen();
    await rm(verzeichnis, { recursive: true, force: true });
    throw e;
  }

  return {
    url,
    port: vorbau.port,
    anhalten,
    starten,
    async neuStarten() {
      await anhalten();
      await starten();
    },
    async voll(an) {
      const c = new Redis(url, { maxRetriesPerRequest: 1 });
      c.on("error", () => undefined);
      try {
        await c.config("SET", "maxmemory", an ? "1" : "0");
      } finally {
        c.disconnect();
      }
    },
    async beenden() {
      await anhalten();
      await vorbau.schliessen();
      await rm(verzeichnis, { recursive: true, force: true });
    },
    log: () => ausgabe,
  };
}
