import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { legeSkriptbaumAn, skriptUmgebung } from "../test/docker-attrappe";

/**
 * scripts/projektname.sh gegen ein gefaelschtes `docker`
 * (test/docker-attrappe.ts).
 *
 * docker-compose.yml setzt "name: dokunc"; vorher hiess das Projekt wie
 * das Verzeichnis. Eine Installation in "Wiki Alt" hat ihre Daten in den
 * Volumes wikialt_db_data und wikialt_app_data. Ohne Festschreiben
 * startete sie nach dem Update als Projekt dokunc: leer, mit neuem
 * Secret, neben ihren Daten. Das Skript erkennt das vor dem ersten Start
 * (Exit 1) und danach (Exit 2) und schreibt den bisherigen Namen in die
 * .env, ohne die .env sonst zu veraendern. Den Weg mit echtem Docker geht
 * der CI-Job docker ("Compose-Projektname").
 */

const ALT = "2026-05-19T08:00:00Z";
const NEU = "2026-09-30T10:00:00Z";

let tmp: string;
let log: string;

/** Legt das Repository im Verzeichnis `name` an. */
function repoIn(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  legeSkriptbaumAn(dir);
  return dir;
}

function volumes(...paare: [string, string][]): string {
  return paare
    .flatMap(([projekt, datum]) => [`${projekt}_db_data=${datum}`, `${projekt}_app_data=${datum}`])
    .join(" ");
}

function run(dir: string, args: string[] = [], env: Record<string, string> = {}) {
  const umgebung = skriptUmgebung(dir, log, env);
  // Ein Wert der aufrufenden Umgebung darf keinen Test verfaelschen.
  if (!("COMPOSE_PROJECT_NAME" in env)) delete umgebung.COMPOSE_PROJECT_NAME;
  const res = spawnSync("bash", [join(dir, "scripts/projektname.sh"), ...args], {
    cwd: tmp,
    input: "",
    encoding: "utf8",
    env: umgebung,
  });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    protokoll: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
}

const lesen = (pfad: string) => readFileSync(pfad, "utf8");
const modus = (pfad: string) => statSync(pfad).mode & 0o777;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "dokunc-projektname-"));
  log = join(tmp, "docker.log");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("scripts/projektname.sh: Pruefen", () => {
  it("erkennt vor dem ersten Start, dass das Projekt bisher wie das Verzeichnis hiess", () => {
    const dir = repoIn("Wiki Alt");
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["wikialt", ALT]) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Compose-Projekt: dokunc (aus docker-compose.yml)");
    expect(r.stdout).toContain("Noch keine Daten (neue Installation).");
    expect(r.stderr).toBe(
      "✗ Für das Compose-Projekt dokunc gibt es keine Daten, wohl aber für: wikialt (angelegt 2026-05-19). " +
        "Vermutlich hiess das Projekt bisher wikialt (Name des Verzeichnisses). Festschreiben mit: " +
        "./scripts/projektname.sh --festschreiben (docs/admin/compose-project.md)\n",
    );
  });

  it("erkennt nach dem ersten Start eine neue, leere Instanz neben aelteren Daten", () => {
    const dir = repoIn("Wiki Alt");
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["wikialt", ALT], ["dokunc", NEU]) });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Daten: vorhanden (dokunc_db_data, dokunc_app_data, angelegt 2026-09-30)");
    expect(r.stdout).toContain("Weitere dokunc-Projekte auf diesem Host: wikialt (angelegt 2026-05-19)");
    expect(r.stderr).toContain(
      "✗ Das Compose-Projekt dokunc hat Daten (angelegt 2026-09-30), das dokunc-Projekt wikialt (angelegt 2026-05-19) hat aber ältere.",
    );
    expect(r.stderr).toContain(
      "Rückweg: docker compose -p dokunc down (ohne -v), ./scripts/projektname.sh --festschreiben, docker compose up -d.",
    );
  });

  it("meldet nichts, wenn die eigenen Daten die aelteren sind", () => {
    const dir = repoIn("dokunc");
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["dokunc", ALT], ["wikitest", NEU]) });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Weitere dokunc-Projekte auf diesem Host: wikitest (angelegt 2026-09-30)");
  });

  it("warnt nicht wegen aelterer Projekte, wenn der Name ausdruecklich feststeht", () => {
    // Mehrere Installationen auf einem Host, jede mit festem Namen.
    const dir = repoIn("dokunc");
    writeFileSync(join(dir, ".env"), "COMPOSE_PROJECT_NAME=dokunc\n");
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["wikialt", ALT], ["dokunc", NEU]) });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Compose-Projekt: dokunc (aus .env, COMPOSE_PROJECT_NAME)");
  });

  it("nennt eine neue Installation und das Projekt mit Daten", () => {
    const neu = run(repoIn("neu"));
    expect(neu.status).toBe(0);
    expect(neu.stdout).toBe("Compose-Projekt: dokunc (aus docker-compose.yml)\nNoch keine Daten (neue Installation).\n");
    expect(neu.stderr).toBe("");

    const bestand = run(repoIn("dokunc"), [], { FAKE_VOLUMES: volumes(["dokunc", ALT]) });
    expect(bestand.status).toBe(0);
    expect(bestand.stdout).toContain("Daten: vorhanden (dokunc_db_data, dokunc_app_data, angelegt 2026-05-19)");
    expect(bestand.stderr).toBe("");
  });

  it("zaehlt fremde Projekte, die nur db_data haben, nicht mit", () => {
    const dir = repoIn("Wiki Alt");
    const r = run(dir, [], { FAKE_VOLUMES: `ci_db_data=${ALT} g6probe_db_data=${ALT}` });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("Weitere");
  });

  it("schlaegt den Namen von Hand vor, wenn er nicht der des Verzeichnisses ist", () => {
    // Nach einem Umzug nach /srv/dokunc hilft der Verzeichnisname nicht.
    const dir = repoIn("dokunc");
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["altwiki", ALT]) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("wohl aber für: altwiki (angelegt 2026-05-19).");
    expect(r.stderr).toContain("./scripts/projektname.sh --festschreiben NAME");
  });

  it("gibt mit --name nur den Namen aus", () => {
    const dir = repoIn("x");
    expect(run(dir, ["--name"]).stdout).toBe("dokunc\n");
    expect(run(dir, ["--name"], { COMPOSE_PROJECT_NAME: "wiki" }).stdout).toBe("wiki\n");
  });

  it("bricht ab, wenn docker compose config scheitert", () => {
    const r = run(repoIn("x"), [], { FAKE_CONFIG_EXIT: "15" });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("✗ docker compose config gescheitert");
    expect(r.stderr).toContain("unexpected character");
  });

  it("prueft die Argumente, bevor Docker angefasst wird", () => {
    const dir = repoIn("x");
    for (const args of [["--unbekannt"], ["x"], ["--name", "x"], ["--festschreiben", "a", "b"]]) {
      const r = run(dir, args);
      expect(r.status, args.join(" ")).toBe(3);
      expect(r.stderr, args.join(" ")).toContain("Nutzung");
      expect(r.protokoll, args.join(" ")).toBe("");
    }
  });
});

describe("scripts/projektname.sh: Festschreiben", () => {
  it("schreibt den bisherigen Namen in eine neue .env, nur fuer den Eigentuemer, und aendert beim zweiten Lauf nichts", () => {
    const dir = repoIn("Wiki Alt");
    const env = { FAKE_VOLUMES: volumes(["wikialt", ALT]) };
    const r = run(dir, ["--festschreiben"], env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(
      "✓ COMPOSE_PROJECT_NAME=wikialt in .env eingetragen (Volumes wikialt_db_data, wikialt_app_data).\n",
    );
    const datei = join(dir, ".env");
    expect(lesen(datei)).toBe(
      "# Compose-Projekt dieser Installation (scripts/projektname.sh)\nCOMPOSE_PROJECT_NAME=wikialt\n",
    );
    expect(modus(datei)).toBe(0o600);

    const zweiter = run(dir, ["--festschreiben"], env);
    expect(zweiter.status).toBe(0);
    expect(zweiter.stdout).toContain("ist schon gesetzt: wikialt (aus .env, COMPOSE_PROJECT_NAME). Nichts geändert.");
    expect(lesen(datei).match(/COMPOSE_PROJECT_NAME/g)).toHaveLength(1);

    const pruefen = run(dir, [], env);
    expect(pruefen.status).toBe(0);
    expect(pruefen.stdout).toContain("Compose-Projekt: wikialt (aus .env, COMPOSE_PROJECT_NAME)");
  });

  it("haengt an eine .env ohne Zeilenende an, ohne deren letzte Variable zu aendern", () => {
    const dir = repoIn("Wiki Alt");
    const datei = join(dir, ".env");
    writeFileSync(datei, "APP_URL=https://wiki.firma.ch\nAPP_SECRET=x");
    chmodSync(datei, 0o640);
    const r = run(dir, ["--festschreiben"], { FAKE_VOLUMES: volumes(["wikialt", ALT]) });
    expect(r.status, r.stderr).toBe(0);
    expect(lesen(datei).split("\n")).toEqual([
      "APP_URL=https://wiki.firma.ch",
      "APP_SECRET=x",
      "# Compose-Projekt dieser Installation (scripts/projektname.sh)",
      "COMPOSE_PROJECT_NAME=wikialt",
      "",
    ]);
    expect(modus(datei)).toBe(0o640);
  });

  it("schreibt durch einen Symlink auf die .env hindurch", () => {
    const dir = repoIn("Wiki Alt");
    const ziel = join(tmp, "geheim.env");
    writeFileSync(ziel, "APP_SECRET=x\n");
    symlinkSync(ziel, join(dir, ".env"));
    const r = run(dir, ["--festschreiben"], { FAKE_VOLUMES: volumes(["wikialt", ALT]) });
    expect(r.status, r.stderr).toBe(0);
    expect(lstatSync(join(dir, ".env")).isSymbolicLink()).toBe(true);
    expect(lesen(ziel)).toContain("COMPOSE_PROJECT_NAME=wikialt\n");
  });

  it("schreibt den aktuellen Namen, wenn es keinen bisherigen mit Daten gibt", () => {
    const bestand = repoIn("dokunc");
    const r = run(bestand, ["--festschreiben"], { FAKE_VOLUMES: volumes(["dokunc", ALT]) });
    expect(r.stdout).toContain("✓ COMPOSE_PROJECT_NAME=dokunc in .env eingetragen (Volumes dokunc_db_data, dokunc_app_data).");
    const neu = repoIn("Wiki Neu");
    const n = run(neu, ["--festschreiben"]);
    expect(n.stdout).toBe("✓ COMPOSE_PROJECT_NAME=dokunc in .env eingetragen (noch keine Daten).\n");
  });

  it("nimmt einen Namen von Hand, aber nur mit Daten und in gueltiger Form", () => {
    const dir = repoIn("dokunc");
    const env = { FAKE_VOLUMES: volumes(["altwiki", ALT]) };
    const fehlt = run(dir, ["--festschreiben", "altwik"], env);
    expect(fehlt.status).toBe(1);
    expect(fehlt.stderr).toContain("Für das Compose-Projekt altwik gibt es keine Daten");
    const falsch = run(dir, ["--festschreiben", "Alt Wiki"], env);
    expect(falsch.status).toBe(3);
    expect(existsSync(join(dir, ".env"))).toBe(false);

    const r = run(dir, ["--festschreiben", "altwiki"], env);
    expect(r.status, r.stderr).toBe(0);
    expect(lesen(join(dir, ".env"))).toContain("COMPOSE_PROJECT_NAME=altwiki\n");
  });

  it("aendert nichts, wenn der Name schon in der Umgebung oder der .env steht", () => {
    const dir = repoIn("Wiki Alt");
    const env = { FAKE_VOLUMES: volumes(["wikialt", ALT]) };
    const umgebung = run(dir, ["--festschreiben"], { ...env, COMPOSE_PROJECT_NAME: "wiki" });
    expect(umgebung.status).toBe(0);
    expect(umgebung.stdout).toContain("ist schon gesetzt: wiki (aus der Umgebung, COMPOSE_PROJECT_NAME)");
    expect(existsSync(join(dir, ".env"))).toBe(false);

    writeFileSync(join(dir, ".env"), 'COMPOSE_PROJECT_NAME="wiki"\n');
    const datei = run(dir, ["--festschreiben", "wikialt"], env);
    expect(datei.status).toBe(3);
    expect(datei.stderr).toContain("COMPOSE_PROJECT_NAME ist schon gesetzt");
    expect(lesen(join(dir, ".env"))).toBe('COMPOSE_PROJECT_NAME="wiki"\n');
  });
});
