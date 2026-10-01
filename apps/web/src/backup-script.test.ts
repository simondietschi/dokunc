import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  falschesDatum,
  legeSkriptbaumAn,
  skriptUmgebung,
} from "../test/docker-attrappe";

/**
 * scripts/backup.sh gegen ein gefaelschtes `docker` (test/docker-attrappe.ts).
 *
 * Was hier zaehlt: ein Satz entsteht nur, wenn Dump und Archiv geprueft
 * sind, sonst bleibt backups/ unveraendert; die Aufbewahrung loescht nur
 * nach Erfolg, nur nach Namensmuster und nie die drei juengsten Saetze;
 * das Secret geht nur ausserhalb des Repositorys und nie ueber ein
 * anderes; ein erfolgreicher Lauf mit getrennt gesichertem Secret
 * schreibt nichts auf stderr (cron). Den Weg gegen echtes Docker geht der
 * CI-Job docker (Rundlauf).
 *
 * Aufbau: <tmp>/repo/ ist das Repository, <tmp>/aussen/ liegt ausserhalb.
 * Jeder Lauf bekommt ueber bin/date (falschesDatum) einen eigenen
 * Zeitstempel einige Sekunden nach jetzt: zwei Laeufe in derselben
 * Sekunde brechen sonst gewollt ab (Test "gleicher Zeitstempel").
 */

let tmp: string;
let repo: string;
let aussen: string;
let log: string;
let laeufe: number;

const TAG_MS = 24 * 60 * 60 * 1000;
const ALTE = ["20200101-120000", "20200102-120000"];

/** Zeitstempel im Format von backup.sh (UTC, wie TZ im Test). */
function stempel(ms: number): string {
  const iso = new Date(ms).toISOString(); // 2026-09-27T01:58:46.000Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

function vorTagen(n: number): string {
  return stempel(Date.now() - n * TAG_MS);
}

function run(
  args: string[] = [],
  opts: { env?: Record<string, string>; cwd?: string } = {},
) {
  laeufe += 1;
  const res = spawnSync("bash", [join(repo, "scripts/backup.sh"), ...args], {
    cwd: opts.cwd ?? repo,
    input: "",
    encoding: "utf8",
    env: skriptUmgebung(repo, log, {
      FAKE_TS: stempel(Date.now() + laeufe * 1000),
      ...opts.env,
    }),
  });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    protokoll: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
}

function backups(): string[] {
  return readdirSync(join(repo, "backups")).sort();
}

function satz(ts: string) {
  writeFileSync(join(repo, `backups/db-${ts}.dump`), "DUMP");
  writeFileSync(join(repo, `backups/uploads-${ts}.tar.gz`), "ARCHIV");
}

function hatSatz(ts: string): boolean {
  const db = existsSync(join(repo, `backups/db-${ts}.dump`));
  const up = existsSync(join(repo, `backups/uploads-${ts}.tar.gz`));
  expect(db, `db und uploads von ${ts} gemeinsam`).toBe(up);
  return db;
}

const ZWISCHEN = /^\.(.*\.teil|fehler\..*|liste\..*)$/;

/** Kein neuer Satz gegenueber `vorher` und keine Zwischendatei. */
function keinSatz(vorher: string[]) {
  const neu = backups().filter(
    (f) => /^(db|uploads)-/.test(f) && !vorher.includes(f),
  );
  expect(neu).toEqual([]);
  expect(backups().filter((f) => ZWISCHEN.test(f))).toEqual([]);
}

function neueSaetze(vorher: string[]): string[] {
  return backups().filter(
    (f) => /^db-\d{8}-\d{6}\.dump$/.test(f) && !vorher.includes(f),
  );
}

function modus(pfad: string): number {
  return statSync(pfad).mode & 0o777;
}

function dumpZeilen(stdout: string): string[] {
  return stdout.match(/backups\/db-\d{8}-\d{6}\.dump$/gm) ?? [];
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "dokunc-backup-"));
  repo = join(tmp, "repo");
  aussen = join(tmp, "aussen");
  mkdirSync(repo);
  mkdirSync(aussen);
  log = join(tmp, "docker.log");
  laeufe = 0;
  legeSkriptbaumAn(repo);
  falschesDatum(repo);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("scripts/backup.sh: Sicherung", () => {
  it("legt einen geprueften Satz an, stderr leer", () => {
    const r = run([], { env: { FAKE_SECRET_LAGE: "env" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe("");

    const neu = neueSaetze([]);
    expect(neu).toHaveLength(1);
    const ts = neu[0]!.slice(3, 18);
    const dump = join(repo, `backups/db-${ts}.dump`);
    const archiv = join(repo, `backups/uploads-${ts}.tar.gz`);
    expect(readFileSync(dump, "utf8")).toBe("DUMP");
    expect(modus(dump)).toBe(0o600);
    expect(modus(archiv)).toBe(0o600);
    expect(modus(join(repo, "backups"))).toBe(0o700);
    const liste = spawnSync("tar", ["tzf", archiv], { encoding: "utf8" });
    expect(liste.status).toBe(0);
    expect(liste.stdout.split("\n")).toContain("./bild.png");

    const p = r.protokoll;
    const dumpen = p.indexOf("pg_dump");
    const packen = p.indexOf("--entrypoint tar app czf - -C /app/uploads .");
    const inhalt = p.indexOf("pg_restore --list");
    const lesen = p.indexOf("pg_restore -f /dev/null");
    expect(dumpen).toBeGreaterThan(-1);
    expect(packen).toBeGreaterThan(dumpen);
    expect(inhalt).toBeGreaterThan(packen);
    expect(lesen).toBeGreaterThan(inhalt);

    // restore.sh und die CI lesen genau diese eine Zeile.
    expect(dumpZeilen(r.stdout)).toEqual([`backups/db-${ts}.dump`]);
    expect(r.stdout).toContain(`./scripts/restore.sh ${ts}`);
    keinSatz(backups());
  });

  it("legt keinen Satz an, wenn pg_dump scheitert", () => {
    const r = run([], { env: { FAKE_PGDUMP_EXIT: "1" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("✗ Datenbank-Dump gescheitert");
    expect(r.stderr).toContain('service "db" is not running');
    expect(r.stdout).not.toContain("✓ Fertig");
    expect(r.protokoll).toContain("pg_dump");
    expect(r.protokoll).not.toContain("czf -");
    keinSatz([]);
  });

  it("legt keinen Satz an, wenn tar scheitert, und zeigt den Fehler ohne Fortschritt", () => {
    const r = run([], { env: { FAKE_TAR_EXIT: "2" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Uploads packen gescheitert");
    expect(r.stderr).toContain("Permission denied");
    expect(r.stderr).not.toContain("Creating");
    expect(r.stdout).not.toContain("✓ Fertig");
    keinSatz([]);
  });

  it("erkennt ein abgeschnittenes Archiv trotz Exit 0", () => {
    const r = run([], { env: { FAKE_TAR: "abgeschnitten" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Uploads-Archiv unvollständig");
    keinSatz([]);
  });

  it("erkennt einen unvollstaendigen Dump", () => {
    const r = run([], { env: { FAKE_DUMP_EXIT: "1" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Dump unvollständig");
    keinSatz([]);
  });

  it("verlangt die Tabelle _prisma_migrations im Dump", () => {
    const r = run([], {
      env: {
        FAKE_LISTE: "1; 0 0 TABLE DATA public _prisma_migrations_x dokunc",
      },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("_prisma_migrations nicht");
    keinSatz([]);
  });

  it("bricht bei gleichem Zeitstempel ab, ohne den vorhandenen Satz anzufassen", () => {
    writeFileSync(join(repo, "backups/db-20260101-120000.dump"), "ALT");
    const r = run([], { env: { FAKE_TS: "20260101-120000" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("gibt es schon");
    expect(
      readFileSync(join(repo, "backups/db-20260101-120000.dump"), "utf8"),
    ).toBe("ALT");
    expect(
      existsSync(join(repo, "backups/uploads-20260101-120000.tar.gz")),
    ).toBe(false);
    keinSatz(backups());

    // Positivkontrolle: eine Sekunde spaeter entsteht der Satz.
    const weiter = run([], { env: { FAKE_TS: "20260101-120001" } });
    expect(weiter.status, weiter.stderr).toBe(0);
    expect(hatSatz("20260101-120001")).toBe(true);
  });
});

describe("scripts/backup.sh: Compose-Projekt", () => {
  // Nach einem Update ohne ./scripts/projektname.sh --festschreiben
  // saehe das Skript die neue, leere Instanz. cron verwirft stdout; eine
  // Abweichung muss auf stderr stehen, und die Aufbewahrung darf die
  // guten alten Saetze nicht loeschen.
  const ALT = "2026-05-19T08:00:00Z";
  const NEU = "2026-09-30T10:00:00Z";
  const vol = (p: string, d: string) =>
    `${p}_db_data=${d} ${p}_redis_data=${d} ${p}_uploads=${d} ${p}_app_data=${d}`;
  // Eine Installation aus der Zeit vor dem Volume app_data.
  const volVorAppData = (p: string, d: string) => `${p}_db_data=${d} ${p}_redis_data=${d} ${p}_uploads=${d}`;

  it("nennt das Projekt als erste Zeile und im Abschluss", () => {
    const r = run([], { env: { FAKE_VOLUMES: vol("dokunc", ALT) } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe("Compose-Projekt: dokunc");
    expect(r.stdout).toContain("✓ Fertig (Compose-Projekt dokunc):");
    expect(r.stderr).toBe("");
  });

  it.each([
    ["ohne eigene Daten", vol("wiki", ALT), "✗ Für das Compose-Projekt dokunc gibt es keine Daten"],
    ["neben aelteren Daten", `${vol("wiki", ALT)} ${vol("dokunc", NEU)}`, "✗ Das Compose-Projekt dokunc hat Daten"],
    [
      "neben aelteren Daten ohne app_data",
      `${volVorAppData("wiki", ALT)} ${vol("dokunc", NEU)}`,
      "✗ Das Compose-Projekt dokunc hat Daten",
    ],
  ])("meldet eine Abweichung %s auf stderr und loescht nichts", (_fall, volumes, meldung) => {
    // Drei junge Saetze dazu: sonst behielte die Aufbewahrung die alten
    // ohnehin (die drei juengsten bleiben immer).
    for (const ts of [...ALTE, vorTagen(1), vorTagen(2), vorTagen(3)]) satz(ts);
    const r = run([], { env: { FAKE_VOLUMES: volumes, BACKUP_KEEP_DAYS: "7" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(meldung);
    expect(r.stderr).toContain(
      "Warnung: Die Prüfung des Compose-Projekts schlägt an (./scripts/projektname.sh). Diese Sicherung löscht keine älteren Sätze.",
    );
    expect(r.stdout).not.toContain("Gelöscht");
    for (const ts of ALTE) expect(hatSatz(ts)).toBe(true);
    expect(dumpZeilen(r.stdout)).toHaveLength(1);
  });

  it("gibt einen Hinweis der Pruefung auch bei Exit 0 auf stderr weiter", () => {
    // Das Anlagedatum der eigenen Datenbank ist nicht lesbar: die Pruefung
    // endet mit 0, der Vergleich mit dem aelteren Projekt blieb aber aus.
    // cron verwirft stdout; der Hinweis muss auf stderr stehen.
    for (const ts of [...ALTE, vorTagen(1), vorTagen(2), vorTagen(3)]) satz(ts);
    const r = run([], {
      env: { FAKE_VOLUMES: `${vol("altwiki", ALT)} ${vol("dokunc", "kaputt")}`, BACKUP_KEEP_DAYS: "7" },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("Hinweis: Das Anlagedatum von dokunc (kaputt) lässt sich nicht lesen");
    expect(r.stderr).not.toContain("Warnung: Die Prüfung des Compose-Projekts");
    expect(r.stdout).toContain("Gelöscht (älter als 7 Tage): 20200101-120000 20200102-120000");
  });

  it("haelt die Aufbewahrung nicht wegen einer anderen Anwendung unter dem Namen des Verzeichnisses an", () => {
    // Im Verzeichnis repo lief vorher eine andere Compose-Anwendung mit
    // aelteren Volumes repo_db_data und repo_redis_data, ohne repo_uploads.
    for (const ts of [...ALTE, vorTagen(1), vorTagen(2), vorTagen(3)]) satz(ts);
    const fremd = `repo_db_data=${ALT} repo_redis_data=${ALT} repo_docmost=${ALT}`;
    const r = run([], { env: { FAKE_VOLUMES: `${fremd} ${vol("dokunc", NEU)}`, BACKUP_KEEP_DAYS: "7" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Gelöscht (älter als 7 Tage): 20200101-120000 20200102-120000");
  });

  it("nennt das Projekt auch beim Sichern des Secrets und warnt bei einer Abweichung", () => {
    const ziel = join(aussen, "geheim");
    const secret = { FAKE_SECRET: "s".repeat(40), FAKE_SECRET_LAGE: "merkmal abc" };
    const gut = run(["--secret-sichern", ziel], { env: { ...secret, FAKE_VOLUMES: vol("dokunc", ALT) } });
    expect(gut.status, gut.stderr).toBe(0);
    expect(gut.stdout.split("\n")[0]).toBe("Compose-Projekt: dokunc");
    expect(gut.stderr).toBe("");

    rmSync(ziel);
    const r = run(["--secret-sichern", ziel], {
      env: { ...secret, FAKE_VOLUMES: `${vol("wiki", ALT)} ${vol("dokunc", NEU)}` },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe("Compose-Projekt: dokunc");
    expect(r.stderr).toContain("✗ Das Compose-Projekt dokunc hat Daten");
    expect(r.stderr).toContain(
      "Warnung: Die Prüfung des Compose-Projekts schlägt an (./scripts/projektname.sh). Das Secret stammt aus dem " +
        "Compose-Projekt dokunc; gehört das nicht zu dieser Installation, nach dem Festschreiben erneut sichern.",
    );
    expect(existsSync(ziel)).toBe(true);
  });

  it("fragt bei einem nicht laufenden Datenbankdienst nach dem Projektnamen", () => {
    const r = run([], { env: { FAKE_PGDUMP_EXIT: "1" } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Compose-Projekt dokunc: stimmt der Projektname? ./scripts/projektname.sh");
  });
});

describe("scripts/backup.sh: Aufbewahrung", () => {
  it("loescht nur alte Saetze und nur nach Namensmuster", () => {
    const jung = [vorTagen(1), vorTagen(2)];
    writeFileSync(join(repo, "backups/db-20190101-000000.dump"), "DUMP");
    for (const ts of [...ALTE, ...jung]) satz(ts);
    writeFileSync(join(repo, "backups/notiz.txt"), "x");
    writeFileSync(join(repo, "backups/db-kaputt.dump"), "x");

    // Positivkontrolle: ohne Variable bleibt alles.
    const ohne = run();
    expect(ohne.status, ohne.stderr).toBe(0);
    expect(ohne.stdout).not.toContain("Gelöscht");
    expect(existsSync(join(repo, "backups/db-20190101-000000.dump"))).toBe(
      true,
    );
    for (const ts of ALTE) expect(hatSatz(ts)).toBe(true);

    const vorher = backups();
    const r = run([], { env: { BACKUP_KEEP_DAYS: "7" } });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(repo, "backups/db-20190101-000000.dump"))).toBe(
      false,
    );
    for (const ts of ALTE) expect(hatSatz(ts)).toBe(false);
    for (const ts of jung) expect(hatSatz(ts)).toBe(true);
    expect(neueSaetze([])).toHaveLength(4); // zwei junge, zwei neue
    expect(neueSaetze(vorher)).toHaveLength(1);
    expect(existsSync(join(repo, "backups/notiz.txt"))).toBe(true);
    expect(existsSync(join(repo, "backups/db-kaputt.dump"))).toBe(true);
    expect(r.stdout).toContain(
      "Gelöscht (älter als 7 Tage): 20190101-000000 20200101-120000 20200102-120000",
    );
    expect(dumpZeilen(r.stdout)).toHaveLength(1);
  });

  it("liest den Wert aus der .env, die Umgebung hat Vorrang", () => {
    writeFileSync(join(repo, ".env"), 'FOO=1\nBACKUP_KEEP_DAYS="7" # Tage\n');
    for (const ts of [...ALTE, vorTagen(1), vorTagen(2)]) satz(ts);

    const ausDatei = run();
    expect(ausDatei.status, ausDatei.stderr).toBe(0);
    for (const ts of ALTE) expect(hatSatz(ts)).toBe(false);

    for (const ts of ALTE) satz(ts);
    const umgebung = run([], { env: { BACKUP_KEEP_DAYS: "0" } });
    expect(umgebung.status, umgebung.stderr).toBe(0);
    for (const ts of ALTE) expect(hatSatz(ts)).toBe(true);
  });

  it("loescht bei ungueltigen Werten nichts und warnt", () => {
    for (const ts of [
      "20200101-120000",
      vorTagen(1),
      vorTagen(2),
      vorTagen(3),
    ]) {
      satz(ts);
    }
    for (const wert of ["14d", "-1", "1.5", "zehn", "1e3"]) {
      const vorher = backups();
      const r = run([], { env: { BACKUP_KEEP_DAYS: wert } });
      expect(r.status, wert).toBe(0);
      expect(r.stderr, wert).toContain("Ungültiger Wert für BACKUP_KEEP_DAYS");
      expect(hatSatz("20200101-120000"), wert).toBe(true);
      expect(neueSaetze(vorher), wert).toHaveLength(1);
    }
  });

  it("liest fuehrende Nullen dezimal", () => {
    const tage = [1, 2, 8, 10, 20];
    const ts = new Map(tage.map((n) => [n, vorTagen(n)]));
    const saetze = () => {
      for (const n of tage) satz(ts.get(n)!);
    };
    const da = () => tage.filter((n) => hatSatz(ts.get(n)!));

    saetze();
    const neun = run([], { env: { BACKUP_KEEP_DAYS: "09" } });
    expect(neun.status, neun.stderr).toBe(0);
    expect(da()).toEqual([1, 2, 8]);

    saetze();
    const vierzehn = run([], { env: { BACKUP_KEEP_DAYS: "000014" } });
    expect(vierzehn.status, vierzehn.stderr).toBe(0);
    expect(vierzehn.stderr).not.toContain("gekappt");
    expect(da()).toEqual([1, 2, 8, 10]);

    saetze();
    const null7 = run([], { env: { BACKUP_KEEP_DAYS: "0000000" } });
    expect(null7.status, null7.stderr).toBe(0);
    expect(null7.stderr).not.toContain("Warnung");
    expect(null7.stdout).not.toContain("Gelöscht");
    expect(da()).toEqual(tage);
  });

  it("kappt zu grosse Werte auf 36500", () => {
    for (const ts of [
      "20200101-120000",
      vorTagen(1),
      vorTagen(2),
      vorTagen(3),
    ]) {
      satz(ts);
    }
    for (const wert of ["99999999999999999999", "36501"]) {
      const r = run([], { env: { BACKUP_KEEP_DAYS: wert } });
      expect(r.status, wert).toBe(0);
      expect(r.stderr, wert).toContain("auf 36500 gekappt");
      expect(hatSatz("20200101-120000"), wert).toBe(true);
    }
  });

  it("loescht nach einem gescheiterten Lauf nichts", () => {
    for (const ts of [...ALTE, vorTagen(1), vorTagen(2)]) satz(ts);
    const r = run([], {
      env: { BACKUP_KEEP_DAYS: "7", FAKE_PGDUMP_EXIT: "1" },
    });
    expect(r.status).toBe(1);
    for (const ts of ALTE) expect(hatSatz(ts)).toBe(true);

    // Positivkontrolle: derselbe Aufbau ohne Fehlschlag loescht sie.
    const gut = run([], { env: { BACKUP_KEEP_DAYS: "7" } });
    expect(gut.status, gut.stderr).toBe(0);
    for (const ts of ALTE) expect(hatSatz(ts)).toBe(false);
  });

  it("behaelt immer die drei juengsten Saetze", () => {
    const alt = ["20200101-120000", "20200102-120000", "20200103-120000"];
    for (const ts of alt) satz(ts);
    const r = run([], { env: { BACKUP_KEEP_DAYS: "7" } });
    expect(r.status, r.stderr).toBe(0);
    expect(hatSatz("20200101-120000")).toBe(false);
    expect(hatSatz("20200102-120000")).toBe(true);
    expect(hatSatz("20200103-120000")).toBe(true);
    expect(r.stdout).toContain("Gelöscht (älter als 7 Tage): 20200101-120000");
  });

  it("schreibt bei einem Tag die Einzahl", () => {
    for (const ts of [...ALTE, "20200103-120000", vorTagen(2)]) satz(ts);
    const r = run([], { env: { BACKUP_KEEP_DAYS: "1" } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Gelöscht (älter als 1 Tag): 20200101-120000");
    expect(r.stdout).not.toContain("1 Tage");
  });
});

describe("scripts/backup.sh: APP_SECRET", () => {
  const MERKMAL = () => join(repo, "backups/.app_secret-merkmal");

  it("meldet den Stand des Secrets passend und nur Warnungen auf stderr", () => {
    const env = run([], { env: { FAKE_SECRET_LAGE: "env" } });
    expect(env.status).toBe(0);
    expect(env.stdout).toContain(".env getrennt");
    expect(env.stderr).toBe("");

    const ohneDatei = run([], { env: { FAKE_SECRET_LAGE: "merkmal abc" } });
    expect(ohneDatei.status).toBe(0);
    expect(ohneDatei.stderr).toContain("--secret-sichern ~/dokunc-app_secret");
    expect(ohneDatei.stderr.trim().split("\n")).toHaveLength(1);

    writeFileSync(MERKMAL(), "abc\n");
    const passend = run([], { env: { FAKE_SECRET_LAGE: "merkmal abc" } });
    expect(passend.status).toBe(0);
    expect(passend.stdout).toContain("getrennt gesichert");
    expect(passend.stderr).toBe("");

    writeFileSync(MERKMAL(), "def\n");
    const anders = run([], { env: { FAKE_SECRET_LAGE: "merkmal abc" } });
    expect(anders.status).toBe(0);
    expect(anders.stderr).toContain(
      "ein anderes als bei der letzten getrennten Sicherung",
    );
    expect(anders.stderr.trim().split("\n")).toHaveLength(1);

    const gescheitert = run([], { env: { FAKE_LAGE_EXIT: "1" } });
    expect(gescheitert.status).toBe(0);
    expect(gescheitert.stderr).toContain(
      "liess sich nicht prüfen (docker compose run app gescheitert)",
    );
    expect(gescheitert.stderr).toContain("Image fehlt");
    expect(gescheitert.stderr).not.toContain("Creating");
    expect(gescheitert.stderr).not.toContain("weder in der .env");

    // Jeder der fuenf Laeufe hat seinen Satz angelegt.
    expect(neueSaetze([])).toHaveLength(5);
  });

  const SECRET = "s".repeat(40);
  const secretEnv = { FAKE_SECRET: SECRET, FAKE_SECRET_LAGE: "merkmal abc" };

  it("sichert das Secret mit relativem Pfad vom Aufrufort aus", () => {
    const r = run(["--secret-sichern", "geheim"], {
      cwd: aussen,
      env: secretEnv,
    });
    expect(r.status, r.stderr).toBe(0);
    const ziel = join(aussen, "geheim");
    expect(readFileSync(ziel, "utf8")).toBe(SECRET);
    expect(modus(ziel)).toBe(0o600);
    expect(readFileSync(MERKMAL(), "utf8").trim()).toBe("abc");
    expect(r.stdout).toContain(`APP_SECRET gesichert: ${ziel}`);
    expect(r.protokoll).toContain("--entrypoint cat app /app/data/app_secret");
    expect(r.protokoll).not.toContain("pg_dump");
    expect(readdirSync(aussen)).toEqual(["geheim"]);
    keinSatz([]);
  });

  it("verweigert Pfade im Repository", () => {
    for (const ziel of ["backups/app_secret", join(repo, "app_secret")]) {
      const r = run(["--secret-sichern", ziel], { env: secretEnv });
      expect(r.status, ziel).toBe(1);
      expect(r.stderr, ziel).toContain("gehört nicht ins Repository");
      expect(existsSync(join(repo, "backups/app_secret"))).toBe(false);
      expect(existsSync(join(repo, "app_secret"))).toBe(false);
      expect(r.protokoll, ziel).toBe("");
    }

    // Positivkontrolle: ausserhalb geht es.
    const gut = run(["--secret-sichern", join(aussen, "x")], {
      env: secretEnv,
    });
    expect(gut.status, gut.stderr).toBe(0);
    expect(gut.protokoll).not.toBe("");
    expect(readFileSync(join(aussen, "x"), "utf8")).toBe(SECRET);
  });

  it("verweigert backups/ auch als Symlink auf einen Ordner ausserhalb", () => {
    // Gaengige Einrichtung: backups liegt auf einer zweiten Platte.
    const platte = join(aussen, "platte");
    mkdirSync(join(platte, "backups"), { recursive: true });
    rmSync(join(repo, "backups"), { recursive: true });
    symlinkSync(join(platte, "backups"), join(repo, "backups"));
    for (const ziel of [
      "backups/app_secret",
      join(platte, "backups/app_secret"),
      join(platte, "backups/../backups/app_secret"),
    ]) {
      const r = run(["--secret-sichern", ziel], { env: secretEnv });
      expect(r.status, ziel).toBe(1);
      expect(r.stderr, ziel).toContain("nicht zu den Sicherungen");
      expect(r.protokoll, ziel).toBe("");
      expect(readdirSync(join(platte, "backups")), ziel).toEqual([]);
    }

    // Positivkontrolle: neben backups/ auf derselben Platte geht es.
    const gut = run(["--secret-sichern", join(platte, "app_secret")], {
      env: secretEnv,
    });
    expect(gut.status, gut.stderr).toBe(0);
    expect(readFileSync(join(platte, "app_secret"), "utf8")).toBe(SECRET);
  });

  it("ueberschreibt kein anderes Secret", () => {
    const ziel = join(aussen, "geheim");
    writeFileSync(ziel, "t".repeat(40));
    const anders = run(["--secret-sichern", ziel], { env: secretEnv });
    expect(anders.status).toBe(1);
    expect(anders.stderr).toContain("enthält ein anderes Secret");
    expect(readFileSync(ziel, "utf8")).toBe("t".repeat(40));
    expect(existsSync(MERKMAL())).toBe(false);

    writeFileSync(ziel, SECRET);
    const gleich = run(["--secret-sichern", ziel], { env: secretEnv });
    expect(gleich.status, gleich.stderr).toBe(0);
    expect(gleich.stdout).toContain("enthält schon");

    // Mit Zeilenende (Editor) ist es fuer die App dasselbe Secret.
    unlinkSync(MERKMAL());
    writeFileSync(ziel, `${SECRET}\n`);
    const zeilenende = run(["--secret-sichern", ziel], { env: secretEnv });
    expect(zeilenende.status, zeilenende.stderr).toBe(0);
    expect(zeilenende.stdout).toContain("enthält schon");
    expect(readFileSync(ziel, "utf8")).toBe(`${SECRET}\n`);
    expect(readFileSync(MERKMAL(), "utf8").trim()).toBe("abc");
    expect(readdirSync(aussen)).toEqual(["geheim"]);
  });

  it("verweigert das Sichern bei Secret in der .env, zu kurzem Secret und Ordner als Ziel", () => {
    const ziel = join(aussen, "geheim");
    const env = run(["--secret-sichern", ziel], {
      env: { FAKE_SECRET: SECRET, FAKE_SECRET_LAGE: "env" },
    });
    expect(env.status).toBe(1);
    expect(env.stderr).toContain("APP_SECRET steht in der .env");

    const kurz = run(["--secret-sichern", ziel], {
      env: { FAKE_SECRET: "kurz", FAKE_SECRET_LAGE: "merkmal abc" },
    });
    expect(kurz.status).toBe(1);
    expect(kurz.stderr).toContain("kürzer als 32 Zeichen");

    const ordner = run(["--secret-sichern", `${aussen}/`], { env: secretEnv });
    expect(ordner.status).toBe(1);
    expect(ordner.stderr).toContain("ist ein Ordner");

    expect(readdirSync(aussen)).toEqual([]);
    expect(existsSync(MERKMAL())).toBe(false);
  });

  it("prueft die Argumente, bevor Docker angefasst wird", () => {
    for (const args of [
      ["--unbekannt"],
      ["--secret-sichern"],
      ["--secret-sichern", ""],
    ]) {
      const r = run(args);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stderr, args.join(" ")).toContain("Nutzung");
      expect(r.protokoll, args.join(" ")).toBe("");
    }
    const hilfe = run(["--help"]);
    expect(hilfe.status).toBe(0);
    expect(hilfe.stdout).toContain("Nutzung: ./scripts/backup.sh");
    expect(hilfe.protokoll).toBe("");
  });
});
