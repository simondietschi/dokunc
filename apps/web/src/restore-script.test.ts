import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * scripts/restore.sh gegen ein gefaelschtes `docker`.
 *
 * Das Skript tauscht im Ernstfall die Datenbank einer laufenden Instanz.
 * Was hier zaehlt, ist die Reihenfolge: erst pruefen und in eine frische
 * Datenbank einspielen, dann anhalten, dann tauschen, und nie einen
 * vorhandenen Stand loeschen. Den Weg gegen echtes Docker geht der
 * CI-Job docker (Rundlauf); dieser Test laeuft ohne Docker und deckt die
 * Abbrueche ab, die der Rundlauf nicht erreicht.
 *
 * Aufbau wie im Repository: <tmp>/scripts/restore.sh (und backup.sh fuer
 * die Vorsicherung), <tmp>/backups/, <tmp>/packages/db/prisma/migrations.
 * Das gefaelschte `docker` steht vorne im PATH, schreibt jeden Aufruf mit
 * (bei psql ohne -c auch das Skript auf stdin) und antwortet je nach
 * Aufruf.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TS = "20260101-120000";
const BEKANNTE_MIGRATION = "20260519132107_init";

const FAKE_DOCKER = `#!/usr/bin/env bash
args="$*"
if [[ "$args" == *psql* && "$args" != *" -c "* ]]; then
  printf 'ARGS %s\\nSTDIN %s\\n' "$args" "$(cat)" >> "$FAKE_LOG"
else
  printf 'ARGS %s\\n' "$args" >> "$FAKE_LOG"
fi
case "$args" in
  *"pg_restore -f /dev/null"*) cat >/dev/null; exit "\${FAKE_DUMP_EXIT:-0}" ;;
  *"cat > /app/data/app_secret"*) printf 'SECRET %s\n' "$(cat)" >> "$FAKE_LOG"; exit 0 ;;
  *"up -d --wait --wait-timeout 300"*) exit "\${FAKE_START_EXIT:-0}" ;;
  *pg_dump*) echo "DUMP"; exit 0 ;;
  *"compose cp "*) ziel="\${@: -1}"; mkdir -p "$ziel"; echo x > "$ziel/datei"; exit 0 ;;
  *_prisma_migrations*) printf '%s\\n' $FAKE_MIGRATIONS; exit 0 ;;
esac
exit 0
`;

let dir: string;
let log: string;

function run(
  args: string[],
  opts: {
    migrations?: string[];
    dumpExit?: number;
    startExit?: number;
    cwd?: string;
  } = {},
) {
  const res = spawnSync("bash", [join(dir, "scripts/restore.sh"), ...args], {
    cwd: opts.cwd ?? dir,
    // stdin ist eine Pipe, kein Terminal (wie in CI oder per ssh ohne -t)
    input: "",
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
      FAKE_LOG: log,
      FAKE_MIGRATIONS: (opts.migrations ?? [BEKANNTE_MIGRATION]).join(" "),
      FAKE_DUMP_EXIT: String(opts.dumpExit ?? 0),
      FAKE_START_EXIT: String(opts.startExit ?? 0),
    },
  });
  return {
    status: res.status,
    out: `${res.stdout}\n${res.stderr}`,
    protokoll: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
}

/** Uploads-Archiv mit einer Datei, wie backup.sh es anlegt. */
function uploadsArchiv(ts: string) {
  const quelle = join(dir, "quelle");
  mkdirSync(quelle, { recursive: true });
  writeFileSync(join(quelle, "bild.png"), "x");
  const r = spawnSync("tar", [
    "czf",
    join(dir, `backups/uploads-${ts}.tar.gz`),
    "-C",
    quelle,
    ".",
  ]);
  expect(r.status).toBe(0);
}

function sicherung(ts = TS) {
  writeFileSync(join(dir, `backups/db-${ts}.dump`), "DUMP");
  uploadsArchiv(ts);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dokunc-restore-"));
  log = join(dir, "docker.log");
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "backups"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "packages/db/prisma/migrations", BEKANNTE_MIGRATION), {
    recursive: true,
  });
  writeFileSync(
    join(dir, "packages/db/prisma/migrations/migration_lock.toml"),
    'provider = "postgresql"\n',
  );
  for (const name of ["restore.sh", "backup.sh"]) {
    copyFileSync(join(ROOT, "scripts", name), join(dir, "scripts", name));
    chmodSync(join(dir, "scripts", name), 0o755);
  }
  writeFileSync(join(dir, "bin/docker"), FAKE_DOCKER);
  chmodSync(join(dir, "bin/docker"), 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("scripts/restore.sh", () => {
  it("verlangt genau einen Zeitstempel und nimmt keinen Pfad an", () => {
    for (const args of [[], ["../x"], ["--ja"], [TS, TS], ["--unbekannt", TS]]) {
      const r = run(args);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.protokoll).toBe("");
    }
  });

  it("bricht ohne Sicherungsdateien ab, bevor Docker angefasst wird", () => {
    const r = run(["--ja", TS]);
    expect(r.status).toBe(1);
    expect(r.out).toContain(`backups/db-${TS}.dump`);
    expect(r.protokoll).toBe("");
  });

  it("bricht bei leerem oder beschaedigtem Uploads-Archiv ab", () => {
    writeFileSync(join(dir, `backups/db-${TS}.dump`), "DUMP");
    writeFileSync(join(dir, `backups/uploads-${TS}.tar.gz`), "");
    const leer = run(["--ja", TS]);
    expect(leer.status).toBe(1);
    expect(leer.out).toContain(`uploads-${TS}.tar.gz`);
    expect(leer.protokoll).toBe("");

    writeFileSync(join(dir, `backups/uploads-${TS}.tar.gz`), "kaputt, kein gzip");
    const kaputt = run(["--ja", TS]);
    expect(kaputt.status).toBe(1);
    expect(kaputt.out).toContain("Uploads-Archiv beschädigt");
    expect(kaputt.protokoll).toBe("");
  });

  it("haelt bei einem unlesbaren Dump nichts an und aendert nichts", () => {
    sicherung();
    const r = run(["--ja", "--ohne-vorsicherung", TS], { dumpExit: 1 });
    expect(r.status).not.toBe(0);
    expect(r.protokoll).toContain("pg_restore -f /dev/null");
    expect(r.protokoll).not.toContain("stop app");
    expect(r.protokoll).not.toMatch(/ run /);
    expect(r.protokoll).not.toContain("psql");
  });

  it("fragt ohne Terminal nicht, sondern bricht vor dem Anhalten ab", () => {
    sicherung();
    const r = run([TS]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("--ja");
    expect(r.protokoll).not.toContain("stop app");
    expect(r.protokoll).not.toContain("backup");
  });

  it("bricht bei einer Sicherung mit unbekannter Migration vor dem Anhalten ab", () => {
    sicherung();
    const r = run(["--ja", "--ohne-vorsicherung", TS], {
      migrations: [BEKANNTE_MIGRATION, "20990101000000_zukunft"],
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("20990101000000_zukunft");
    expect(r.out).toContain("Nichts verändert");
    expect(r.protokoll).not.toContain("stop app");
    expect(r.protokoll).not.toContain("ALTER DATABASE");
    // Die eigene Zwischenablage wird nach der Pruefung wieder geloescht.
    const nachPruefung = r.protokoll.slice(
      r.protokoll.indexOf("_prisma_migrations"),
    );
    expect(nachPruefung).toContain("DROP DATABASE IF EXISTS dokunc_restore");
  });

  it("spielt erst ein, haelt dann an, tauscht und loescht keinen Stand", () => {
    sicherung();
    const r = run(["--ja", TS]);
    expect(r.status, r.out).toBe(0);
    const p = r.protokoll;

    // Vorsicherung vor allem anderen, ihr Zeitstempel steht im Abschluss.
    const vorsicherung = p.indexOf("pg_dump");
    const einspielen = p.indexOf("pg_restore -U dokunc -d dokunc_restore");
    const anhalten = p.indexOf("stop app");
    const tauschen = p.indexOf("ALTER DATABASE");
    expect(vorsicherung).toBeGreaterThan(-1);
    expect(einspielen).toBeGreaterThan(vorsicherung);
    expect(anhalten).toBeGreaterThan(einspielen);
    expect(tauschen).toBeGreaterThan(anhalten);
    expect(r.out).toMatch(/backups\/db-\d{8}-\d{6}\.dump/);

    // Der bisherige Stand bekommt einen eigenen Namen je Lauf.
    expect(p).toMatch(/-v vor=dokunc_vor_\d{8}_\d{6}\s/);
    expect(p).toContain('ALTER DATABASE dokunc RENAME TO :"vor"');
    expect(p).toContain("ALTER DATABASE dokunc_restore RENAME TO dokunc");

    // Geloescht wird nur die eigene Zwischenablage.
    const drops = p.match(/DROP DATABASE[^\n']*/g) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(d).toContain("dokunc_restore");

    // Danach Uploads, Migrationen, Epoche samt Sitzungen und Mails, Start.
    expect(p.indexOf("tar xzf")).toBeGreaterThan(tauschen);
    const migrate = p.indexOf("migrate:deploy");
    expect(migrate).toBeGreaterThan(tauschen);
    const epoche = p.indexOf('INSERT INTO "InstanceState"');
    expect(epoche).toBeGreaterThan(migrate);
    expect(p).toMatch(/-v epoche=[0-9a-f]{32}\s/);
    expect(p).toContain('UPDATE "Session" SET "revokedAt" = now()');
    expect(p).toContain('UPDATE "Notification" SET "emailedAt" = now()');
    expect(p.lastIndexOf("up -d --wait --wait-timeout 300")).toBeGreaterThan(
      epoche,
    );
    expect(r.out).toContain(`Zurückgespielt: Stand vom ${TS}`);
  });

  it("meldet einen gescheiterten Start nicht als gescheiterten Restore", () => {
    sicherung();
    const r = run(["--ja", TS], { startExit: 1 });
    expect(r.status).toBe(1);
    // Positivkontrolle: der Start wurde wirklich versucht, alles davor lief.
    expect(r.protokoll).toContain("up -d --wait --wait-timeout 300");
    expect(r.protokoll).toContain('UPDATE "Notification" SET "emailedAt" = now()');
    // Nur die Meldung des Abbruchs; davor nennt backup.sh selbst restore.sh.
    const meldung = r.out.slice(r.out.indexOf("Abgebrochen bei"));
    expect(meldung).toContain("Abgebrochen bei: App starten");
    expect(meldung).toContain("Erneut zurückspielen ist nicht nötig");
    expect(meldung).not.toContain("Die App bleibt angehalten");
    expect(meldung).not.toMatch(/restore\.sh \d{8}-\d{6}/);
  });

  it("nimmt einen relativen Pfad bei --secret vom Aufrufort aus", () => {
    sicherung();
    const woanders = join(dir, "woanders");
    mkdirSync(woanders);
    const secret = "s".repeat(40);
    writeFileSync(join(woanders, "mein-secret"), `${secret}\n`);
    const r = run(
      ["--ja", "--ohne-vorsicherung", "--secret", "mein-secret", TS],
      { cwd: woanders },
    );
    expect(r.status, r.out).toBe(0);
    expect(r.protokoll).toContain(`SECRET ${secret}`);
  });
});
