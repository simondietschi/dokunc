import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
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
 * Braucht redis-server 7 oder neuer im PATH (der Collab-Server nutzt
 * EXPIRE ... NX). Die CI installiert es im Job e2e; lokal ueberspringt
 * collab-chaos.test.ts sich ohne, mit Hinweis.
 */

export type EigenesRedis = {
  /** REDIS_URL mit Passwort. */
  url: string;
  port: number;
  /** SIGTERM, wartet auf das Ende (AOF ist geschrieben). */
  anhalten(): Promise<void>;
  /** Gleicher Port, gleiches Verzeichnis; wartet, bis PING antwortet. */
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

async function antwortet(url: string, bisMs: number): Promise<boolean> {
  const ende = Date.now() + bisMs;
  while (Date.now() < ende) {
    const c = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
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

export async function starteEigenesRedis(): Promise<EigenesRedis> {
  const verzeichnis = await mkdtemp(join(tmpdir(), "dokunc-redis-"));
  const passwort = randomBytes(12).toString("hex");
  let ausgabe = "";
  let prozess: ChildProcess | null = null;
  let port = 0;

  const url = () => `redis://:${passwort}@127.0.0.1:${port}/0`;
  const args = () => [
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

  async function starten(): Promise<void> {
    const p = spawn("redis-server", args(), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    prozess = p;
    p.stdout?.on("data", (d: Buffer) => (ausgabe += d.toString()));
    p.stderr?.on("data", (d: Buffer) => (ausgabe += d.toString()));
    if (!(await antwortet(url(), 10_000))) {
      p.kill("SIGKILL");
      throw new Error(`redis-server nicht gestartet:\n${ausgabe}`);
    }
  }

  async function anhalten(): Promise<void> {
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

  // Der Port ist frei, wenn die Probe ihn bekommt; belegt ihn ein anderer
  // Lauf bis zum Start, endet redis-server sofort, und es geht mit dem
  // naechsten weiter.
  for (let versuch = 1; ; versuch += 1) {
    port = await freierPort();
    try {
      await starten();
      break;
    } catch (e) {
      if (versuch >= 5) throw e;
    }
  }

  return {
    url: url(),
    port,
    anhalten,
    starten,
    async neuStarten() {
      await anhalten();
      await starten();
    },
    async voll(an) {
      const c = new Redis(url(), { maxRetriesPerRequest: 1 });
      c.on("error", () => undefined);
      try {
        await c.config("SET", "maxmemory", an ? "1" : "0");
      } finally {
        c.disconnect();
      }
    },
    async beenden() {
      await anhalten();
      await rm(verzeichnis, { recursive: true, force: true });
    },
    log: () => ausgabe,
  };
}
