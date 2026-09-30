import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";

/**
 * Die Pruefung der Konfiguration beim Start, am echten Collab-Prozess
 * (tsx src/server.ts wie unter `pnpm --filter @dokunc/collab start`).
 *
 * Ein ungueltiger Wert beendet den Prozess mit Code 78 und genau einer
 * JSON-Zeile der Stufe 60, die das Problem nennt. Frueher warf pino beim
 * Anlegen des Loggers: Klartext-Stacktrace, Code 1. Und jede Zeile der
 * Ausgabe ist JSON, auch die von dotenv (die schrieb ohne `quiet` eine
 * Zeile "injected env" auf stdout).
 *
 * Redis-Datenbank 4, die kein anderer Test benutzt.
 */

const REDIS_DB = 4;
const COLLAB_DIR = fileURLToPath(new URL("../../../collab", import.meta.url));

async function freierPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const adresse = probe.address();
      const port = typeof adresse === "object" && adresse ? adresse.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

type Lauf = { code: number | null; stdout: string; stderr: string };

/** Startet den Collab-Server und wartet hoechstens `frist` ms auf sein Ende. */
async function starteBisEnde(env: Record<string, string>, frist: number): Promise<Lauf> {
  const kind = spawn(join(COLLAB_DIR, "node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: COLLAB_DIR,
    env: {
      ...process.env,
      COLLAB_PORT: String(await freierPort()),
      REDIS_URL: redisUrlMitDb(REDIS_DB),
      AI_INDEX_INTERVAL_S: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Eigene Prozessgruppe: tsx startet den Server als Kind. Laeuft er
    // wider Erwarten weiter, beendet der Test die ganze Gruppe; ein
    // SIGKILL nur an tsx liesse den Server verwaist weiterlaufen, und der
    // hoerte auf den Redis-Kanaelen der folgenden Tests mit.
    detached: true,
  });
  let stdout = "";
  let stderr = "";
  kind.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  kind.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const code = await new Promise<number | null>((resolve) => {
    const zeit = setTimeout(() => {
      if (kind.pid !== undefined) process.kill(-kind.pid, "SIGKILL");
      resolve(null);
    }, frist);
    kind.once("exit", (c) => {
      clearTimeout(zeit);
      resolve(c);
    });
  });
  return { code, stdout, stderr };
}

function zeilen(text: string): string[] {
  return text.split("\n").filter((z) => z.trim() !== "");
}

describe("Collab-Server mit ungueltiger Konfiguration", () => {
  it("endet mit Code 78 und genau einer JSON-Zeile der Stufe 60", async () => {
    const lauf = await starteBisEnde(
      { LOG_LEVEL: "gespraechig", APP_SECRET: randomBytes(32).toString("hex") },
      20_000,
    );
    const ausgabe = `${lauf.stdout}${lauf.stderr}`;
    expect(lauf.code, ausgabe).toBe(78);

    const alle = zeilen(ausgabe);
    for (const z of alle) {
      expect(() => JSON.parse(z), `keine JSON-Zeile: ${z}`).not.toThrow();
    }
    const eintraege = alle.map((z) => JSON.parse(z) as Record<string, unknown>);
    const fatal = eintraege.filter((e) => e.level === 60);
    expect(fatal).toHaveLength(1);
    expect(fatal[0].app).toBe("dokunc-collab");
    const fehler = fatal[0].errors as { variable: string; message: string }[];
    expect(fehler.map((f) => f.variable)).toEqual(["LOG_LEVEL"]);
    expect(fehler[0].message).toContain('"gespraechig"');
    expect(String(fatal[0].msg)).toContain("LOG_LEVEL");
    // Kein Stacktrace, weder im Text noch in einem err-Feld.
    expect(ausgabe).not.toMatch(/\n\s+at /);
    expect(fatal[0].err).toBeUndefined();
  }, 30_000);
});

describe("Collab-Server mit gueltiger Konfiguration", () => {
  let server: Pruefserver | undefined;
  const secret = randomBytes(32).toString("hex");

  afterAll(async () => {
    await server?.stop();
  });

  it("meldet die geprueften Werte und nur die Namen der uebrigen", async () => {
    server = await startePruefserver({
      redisDb: REDIS_DB,
      appSecret: secret,
      env: { LOG_LEVEL: " Info " },
    });
    // Nur die JSON-Zeilen: Hocuspocus schreibt beim Start ein Banner.
    const eintraege = zeilen(server.log())
      .filter((z) => z.startsWith("{"))
      .map((z) => JSON.parse(z) as Record<string, unknown>);
    const geprueft = eintraege.filter((e) => e.msg === "Konfiguration geprueft");
    expect(geprueft).toHaveLength(1);
    expect(geprueft[0].level).toBe(30);
    expect((geprueft[0].config as Record<string, unknown>).LOG_LEVEL).toBe("info");
    expect(geprueft[0].unchecked).toEqual(
      expect.arrayContaining(["APP_SECRET", "DATABASE_URL", "REDIS_URL"]),
    );
    // Werte ungepruefter Variablen stehen nirgends im Log.
    expect(server.log()).not.toContain(secret);
  }, 40_000);
});
