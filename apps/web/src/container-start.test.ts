import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Die beiden Startskripte, die das Redis-Passwort tragen: scripts/redis-start.sh
 * (Dienst redis, erzeugt es und startet Redis damit) und
 * scripts/docker-entrypoint.sh (App, setzt es in REDIS_URL). Beide laufen hier
 * mit sh wie im Container; das Einstiegsskript des Redis-Images ist eine
 * Attrappe vorne im PATH, die ihre Argumente mitschreibt. Ob Redis das
 * Passwort wirklich verlangt und die App es nutzt, prueft der CI-Job docker
 * am laufenden Stack (Schritt "Redis nur mit Passwort").
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REDIS_START = join(ROOT, "scripts/redis-start.sh");
const ENTRYPOINT = join(ROOT, "scripts/docker-entrypoint.sh");

/**
 * Nur die genannten Variablen, nichts aus der Umgebung des Testlaufs (eine
 * REDIS_URL aus .env aenderte sonst das Ergebnis). NODE_ENV verlangt der
 * Typ von process.env in Next.js.
 */
function umgebung(werte: Record<string, string>): NodeJS.ProcessEnv {
  return Object.assign({ NODE_ENV: "test" } as NodeJS.ProcessEnv, werte);
}

const ordner: string[] = [];
function neuerOrdner(): string {
  const d = mkdtempSync(join(tmpdir(), "dokunc-start-"));
  ordner.push(d);
  return d;
}
afterEach(() => {
  for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * redis-start.sh mit Attrappe; liefert Exit, Ausgaben und die Argumente an
 * das Image. authDir: ein Passwortordner, den der Test selbst vorbereitet
 * (sonst dir/auth, frisch angelegt).
 */
function redisStart(dir: string, args: string[], authDir?: string) {
  const bin = join(dir, "bin");
  const auth = authDir ?? join(dir, "auth");
  mkdirSync(bin, { recursive: true });
  if (!authDir) mkdirSync(auth, { recursive: true });
  const argsDatei = join(dir, "args");
  writeFileSync(
    join(bin, "docker-entrypoint.sh"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$FAKE_ARGS"\n',
  );
  chmodSync(join(bin, "docker-entrypoint.sh"), 0o755);
  rmSync(argsDatei, { force: true });
  const r = spawnSync("sh", [REDIS_START, ...args], {
    encoding: "utf8",
    env: umgebung({
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      REDIS_AUTH_DIR: auth,
      FAKE_ARGS: argsDatei,
    }),
  });
  let weiter: string[] | null;
  try {
    weiter = readFileSync(argsDatei, "utf8").split("\n").slice(0, -1);
  } catch {
    // Das Image wurde nicht aufgerufen
    weiter = null;
  }
  return { ...r, auth, weiter };
}

describe("scripts/redis-start.sh", () => {
  it("erzeugt beim ersten Start ein Passwort und haengt es per --include an", () => {
    const d = neuerOrdner();
    const r = redisStart(d, ["redis-server", "--appendonly", "yes"]);
    expect(r.status, r.stderr).toBe(0);
    const pw = readFileSync(join(r.auth, "password"), "utf8");
    expect(pw).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(r.auth, "password")).mode & 0o777).toBe(0o644);
    expect(readFileSync(join(r.auth, "redis.conf"), "utf8")).toBe(
      `requirepass ${pw}\n`,
    );
    // --include am Ende: gilt auch nach eigener Konfigurationsdatei und
    // eigenen Optionen; das Passwort selbst steht in keinem Argument
    expect(r.weiter).toEqual([
      "redis-server",
      "--appendonly",
      "yes",
      "--include",
      join(r.auth, "redis.conf"),
    ]);
    expect(r.weiter?.join(" ")).not.toContain(pw);
  });

  it("behaelt das Passwort bei jedem weiteren Start", () => {
    const d = neuerOrdner();
    redisStart(d, ["redis-server"]);
    const erstes = readFileSync(join(d, "auth", "password"), "utf8");
    const r = redisStart(d, [
      "redis-server",
      "/etc/eigen.conf",
      "--maxmemory",
      "1mb",
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(d, "auth", "password"), "utf8")).toBe(erstes);
    expect(r.weiter).toEqual([
      "redis-server",
      "/etc/eigen.conf",
      "--maxmemory",
      "1mb",
      "--include",
      join(d, "auth", "redis.conf"),
    ]);
  });

  it("uebernimmt ein eigenes gueltiges Passwort und weist ein ungueltiges ab", () => {
    const d = neuerOrdner();
    mkdirSync(join(d, "auth"), { recursive: true });
    // Positivkontrolle: erlaubte Zeichen, Zeilenende am Ende zaehlt nicht.
    // Von Hand mit umask 077 angelegt: danach lesbar fuer die App (node).
    writeFileSync(join(d, "auth", "password"), "Eigenes.Passwort_1~x-y\n", {
      mode: 0o600,
    });
    expect(statSync(join(d, "auth", "password")).mode & 0o777).toBe(0o600);
    const gut = redisStart(d, ["redis-server"]);
    expect(gut.status, gut.stderr).toBe(0);
    expect(readFileSync(join(d, "auth", "redis.conf"), "utf8")).toBe(
      "requirepass Eigenes.Passwort_1~x-y\n",
    );
    expect(statSync(join(d, "auth", "password")).mode & 0o777).toBe(0o644);
    // Zeichen, die in REDIS_URL kodiert werden muessten: Redis startet nicht
    writeFileSync(join(d, "auth", "password"), "p@ss wort");
    const schlecht = redisStart(d, ["redis-server"]);
    expect(schlecht.status).toBe(1);
    expect(schlecht.stderr).toContain("enthaelt kein gueltiges Redis-Passwort");
    expect(schlecht.weiter).toBeNull();
  });

  it("haengt das Passwort auch an einen command ohne redis-server vorne an", () => {
    // Wie der Einstieg des Images: Optionen allein oder eine
    // Konfigurationsdatei zuerst heissen redis-server (override-Datei mit
    // command: ["--maxmemory", "100mb"]). Sonst liefe Redis ohne Passwort.
    for (const [args, erwartet] of [
      [
        ["--appendonly", "yes", "--maxmemory", "100mb"],
        ["redis-server", "--appendonly", "yes", "--maxmemory", "100mb"],
      ],
      [["/etc/redis/eigen.conf"], ["redis-server", "/etc/redis/eigen.conf"]],
      [
        ["/usr/local/bin/redis-server", "--port", "6380"],
        ["/usr/local/bin/redis-server", "--port", "6380"],
      ],
    ]) {
      const d = neuerOrdner();
      const r = redisStart(d, args);
      expect(r.status, r.stderr).toBe(0);
      expect(r.weiter, args.join(" ")).toEqual([
        ...erwartet,
        "--include",
        join(r.auth, "redis.conf"),
      ]);
    }
  });

  it("laesst ein eigenes --requirepass gelten und legt es in die Passwortdatei", () => {
    // Bestehende Installation, die Redis schon selbst geschuetzt hat (mit
    // eigener REDIS_URL fuer die App): kein --include, das ihr Passwort
    // ersetzte. Die Datei dient dem Healthcheck und der Anleitung.
    const d = neuerOrdner();
    const args = [
      "redis-server",
      "--appendonly",
      "yes",
      "--requirepass",
      "Mein+Pw/1",
    ];
    const r = redisStart(d, args);
    expect(r.status, r.stderr).toBe(0);
    expect(r.weiter).toEqual(args);
    expect(readFileSync(join(r.auth, "password"), "utf8")).toBe("Mein+Pw/1");
    expect(statSync(join(r.auth, "password")).mode & 0o777).toBe(0o644);
    expect(r.stdout).toContain("aus --requirepass uebernommen");
  });

  it("ersetzt ein frueheres --requirepass, das REDIS_URL nicht traegt, sobald es wegfaellt", () => {
    // Erst mit eigenem --requirepass (Zeichen wie aus openssl rand -base64),
    // dann ohne (override-Datei entfernt): Redis startet mit neuem Passwort,
    // statt an der eigenen Datei zu scheitern.
    const d = neuerOrdner();
    const mit = redisStart(d, ["redis-server", "--requirepass", "q8Zk+3/AbC=="]);
    expect(mit.status, mit.stderr).toBe(0);
    expect(readFileSync(join(d, "auth", "password"), "utf8")).toBe("q8Zk+3/AbC==");
    const ohne = redisStart(d, ["redis-server", "--appendonly", "yes"]);
    expect(ohne.status, ohne.stderr).toBe(0);
    expect(ohne.stdout).toContain("passt nicht in REDIS_URL, ein neues wird erzeugt");
    const pw = readFileSync(join(d, "auth", "password"), "utf8");
    expect(pw).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(d, "auth", "redis.conf"), "utf8")).toBe(
      `requirepass ${pw}\n`,
    );
    expect(ohne.weiter).toEqual([
      "redis-server",
      "--appendonly",
      "yes",
      "--include",
      join(d, "auth", "redis.conf"),
    ]);
    // Einmal ersetzt, gilt das neue auch beim naechsten Start
    const danach = redisStart(d, ["redis-server"]);
    expect(danach.status, danach.stderr).toBe(0);
    expect(readFileSync(join(d, "auth", "password"), "utf8")).toBe(pw);
  });

  it("behaelt ein frueheres --requirepass, das REDIS_URL traegt, auch ohne", () => {
    // Gegenstueck: gueltige Zeichen bleiben (eine eigene REDIS_URL damit
    // gilt weiter). Ein von Hand hinterlegtes ungueltiges Passwort ohne
    // --requirepass davor weist der Start weiter ab (Test oben).
    const d = neuerOrdner();
    redisStart(d, ["redis-server", "--requirepass", "Eigenes.Pw-1"]);
    const ohne = redisStart(d, ["redis-server"]);
    expect(ohne.status, ohne.stderr).toBe(0);
    expect(ohne.stdout).not.toContain("ein neues wird erzeugt");
    expect(readFileSync(join(d, "auth", "password"), "utf8")).toBe("Eigenes.Pw-1");
    expect(readFileSync(join(d, "auth", "redis.conf"), "utf8")).toBe(
      "requirepass Eigenes.Pw-1\n",
    );
  });

  it("sagt klar, was zu tun ist, wenn der Passwortordner nicht beschreibbar ist", () => {
    // Redis mit user: aus einer override-Datei kann das Volume von root nicht
    // beschreiben. Hier ein Ordner, den es nicht gibt (die Tests laufen
    // lokal als root, der ignoriert fehlende Schreibrechte).
    const d = neuerOrdner();
    const r = redisStart(d, ["redis-server"], join(d, "fehlt"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ist nicht beschreibbar");
    expect(r.stderr).toContain("user: fuer redis aus der docker-compose.override.yml entfernen");
    expect(r.weiter).toBeNull();
    // Andere Befehle brauchen den Ordner nicht
    const cli = redisStart(d, ["redis-cli", "ping"], join(d, "fehlt"));
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.weiter).toEqual(["redis-cli", "ping"]);
  });

  it("reicht andere Befehle unveraendert durch", () => {
    const d = neuerOrdner();
    const r = redisStart(d, ["redis-cli", "ping"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.weiter).toEqual(["redis-cli", "ping"]);
  });
});

/** docker-entrypoint.sh mit `printenv REDIS_URL` als Befehl. */
function einstieg(env: Record<string, string>) {
  return spawnSync("sh", [ENTRYPOINT, "printenv", "REDIS_URL"], {
    encoding: "utf8",
    // APP_SECRET gesetzt: der Einstieg erzeugt dann keines
    env: umgebung({
      PATH: process.env.PATH ?? "",
      APP_SECRET: "x".repeat(48),
      ...env,
    }),
  });
}

describe("scripts/docker-entrypoint.sh: Redis-Passwort", () => {
  function passwortDatei(inhalt: string): string {
    const f = join(neuerOrdner(), "password");
    writeFileSync(f, inhalt);
    return f;
  }

  it("setzt das Passwort in die REDIS_URL des mitgelieferten Dienstes", () => {
    const f = passwortDatei("abc123\n");
    for (const [url, erwartet] of [
      ["redis://redis:6379", "redis://:abc123@redis:6379"],
      ["redis://redis:6379/2", "redis://:abc123@redis:6379/2"],
    ]) {
      const r = einstieg({ REDIS_PASSWORD_FILE: f, REDIS_URL: url });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe(erwartet);
    }
  });

  it("laesst eigene REDIS_URL und Betrieb ohne Passwortdatei unveraendert", () => {
    const f = passwortDatei("abc123");
    const faelle: Record<string, string>[] = [
      { REDIS_PASSWORD_FILE: f, REDIS_URL: "redis://cache.example:6379" },
      { REDIS_PASSWORD_FILE: f, REDIS_URL: "redis://:eigenes@redis:6379" },
      { REDIS_URL: "redis://redis:6379" },
    ];
    for (const env of faelle) {
      const r = einstieg(env);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim(), JSON.stringify(env)).toBe(env.REDIS_URL);
    }
  });

  it("setzt ein Passwort, das in der URL kodiert werden muesste, nicht ein", () => {
    // Positivkontrolle im Test oben; hier ein eigenes --requirepass mit
    // Zeichen ausserhalb der erlaubten (aus redis-start.sh uebernommen)
    const r = einstieg({
      REDIS_PASSWORD_FILE: passwortDatei("Mein+Pw/1"),
      REDIS_URL: "redis://redis:6379",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("redis://redis:6379");
    expect(r.stderr).toContain("braucht in REDIS_URL eine Kodierung");
  });

  it("startet ohne Passwortdatei weiter und sagt warum", () => {
    const r = einstieg({
      REDIS_PASSWORD_FILE: join(neuerOrdner(), "fehlt"),
      REDIS_URL: "redis://redis:6379",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("redis://redis:6379");
    expect(r.stderr).toContain("Redis-Passwort fehlt");
  });
});
