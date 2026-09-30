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
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { legeSkriptbaumAn, skriptUmgebung } from "../test/docker-attrappe";

/**
 * scripts/projektname.sh gegen ein gefaelschtes `docker`
 * (test/docker-attrappe.ts).
 *
 * docker-compose.yml setzt "name: dokunc"; vorher hiess das Projekt wie
 * das Verzeichnis. Eine Installation in "Wiki Alt" hat ihre Daten in den
 * Volumes wikialt_db_data, wikialt_uploads usw. Ohne Festschreiben
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

/** Volumes, wie Compose sie fuer die Fassungen mit app_data anlegt. */
function volumes(...paare: [string, string][]): string {
  return paare
    .flatMap(([projekt, datum]) =>
      ["db_data", "redis_data", "uploads", "app_data"].map((art) => `${projekt}_${art}=${datum}`),
    )
    .join(" ");
}

/**
 * Volumes einer Installation aus der Zeit vor dem Volume app_data: das
 * entsteht erst beim ersten Start mit einer neueren Fassung.
 */
function volumesVorAppData(...paare: [string, string][]): string {
  return paare
    .flatMap(([projekt, datum]) =>
      ["db_data", "redis_data", "uploads"].map((art) => `${projekt}_${art}=${datum}`),
    )
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
    // Eine Endlosschleife soll den Test scheitern lassen, nicht haengen.
    timeout: 20_000,
  });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    protokoll: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
}

/**
 * bin/date wie BSD date (macOS): kein -d, dafuer
 * `date -j -f '%Y-%m-%dT%H:%M:%S%z' 2026-05-19T08:00:00+0000 +%s`.
 * Mit FAKE_DATUM_KAPUTT liest es gar kein Datum.
 */
function bsdDatum(dir: string): void {
  const datei = join(dir, "bin/date");
  writeFileSync(
    datei,
    `#!/usr/bin/env bash
echt=$(PATH="\${PATH#*:}" command -v date)
case "\${1:-}" in
  -d|--date*) echo "date: illegal option -- d" >&2; exit 1 ;;
  -j)
    if [ -z "\${FAKE_DATUM_KAPUTT:-}" ] && [ "\${2:-}" = -f ] && [ "\${3:-}" = '%Y-%m-%dT%H:%M:%S%z' ] \\
      && [[ "\${4:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{4}$ ]]; then
      exec "$echt" -d "$4" "\${5:-+%s}"
    fi
    echo "Failed conversion of \\\`\${4:-}' using format \\\`\${3:-}'" >&2
    exit 1 ;;
esac
exec "$echt" "$@"
`,
  );
  chmodSync(datei, 0o755);
}

/**
 * bin/readlink wie auf macOS vor 12.3: ohne -f. Alles andere geht an das
 * echte readlink.
 */
function readlinkOhneF(dir: string): void {
  const datei = join(dir, "bin/readlink");
  writeFileSync(
    datei,
    `#!/usr/bin/env bash
case "\${1:-}" in -f|-e|-m|--canonicalize*) echo "readlink: illegal option -- \${1#-}" >&2; exit 1 ;; esac
exec "$(PATH="\${PATH#*:}" command -v readlink)" "$@"
`,
  );
  chmodSync(datei, 0o755);
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
    // Beide Projekte haben Container aus diesem Verzeichnis: die alten
    // von vor dem Update, die neuen vom ersten up danach.
    const dir = repoIn("Wiki Alt");
    const r = run(dir, [], {
      FAKE_VOLUMES: volumes(["wikialt", ALT], ["dokunc", NEU]),
      FAKE_CONTAINER: `wikialt=${dir};dokunc=${dir}`,
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Daten: vorhanden (dokunc_db_data, angelegt 2026-09-30)");
    expect(r.stdout).toContain("Weitere dokunc-Projekte auf diesem Host: wikialt (angelegt 2026-05-19)\n");
    expect(r.stderr).toBe(
      "✗ Das Compose-Projekt dokunc hat Daten (angelegt 2026-09-30), das dokunc-Projekt wikialt (angelegt 2026-05-19) hat aber ältere. " +
        "Lief das Update ohne ./scripts/projektname.sh --festschreiben, arbeitet hier eine neue, leere Instanz neben den bisherigen Daten. " +
        "Rückweg: docker compose -p dokunc down (ohne -v), ./scripts/projektname.sh --festschreiben, docker compose up -d; " +
        "lief dokunc vorher für eine andere Installation auf diesem Host, danach dort docker compose up -d. " +
        "Gehören die Daten von dokunc doch zu diesem Verzeichnis (mehrere Installationen auf diesem Host): " +
        "./scripts/projektname.sh --festschreiben dokunc (docs/admin/compose-project.md)\n",
    );
  });

  it("raet ohne Container des Projekts dokunc nicht zu down", () => {
    // Die Container der neuen, leeren Instanz sind schon entfernt: down
    // haette nichts zu tun, ein anderes Verzeichnis aber schon.
    const dir = repoIn("Wiki Alt");
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["wikialt", ALT], ["dokunc", NEU]) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "Rückweg: ./scripts/projektname.sh --festschreiben, docker compose up -d. Gehören die Daten von dokunc doch",
    );
    expect(r.stderr).not.toContain("down");
  });

  it("meldet ein Projekt dokunc mit Containern aus einem anderen Verzeichnis als andere Installation, auch wenn es juenger ist", () => {
    // Zwei Installationen: diese in wiki-test (aelter, Name nicht
    // festgeschrieben, nach git pull noch nicht gestartet) und eine
    // juengere im Verzeichnis dokunc. down hielte die andere an.
    const dir = repoIn("wiki-test");
    const andere = join(tmp, "dokunc");
    mkdirSync(andere);
    const env = {
      FAKE_VOLUMES: volumes(["wiki-test", ALT], ["dokunc", NEU]),
      FAKE_CONTAINER: `wiki-test=${dir};dokunc=${andere}`,
    };
    const r = run(dir, [], env);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      `✗ Die Container des Compose-Projekts dokunc stammen aus einem anderen Verzeichnis (${andere}): ` +
        "vermutlich eine andere Installation auf diesem Host. docker compose up übernähme hier deren Container " +
        "und Datenbank. Festschreiben mit: ./scripts/projektname.sh --festschreiben (schreibt wiki-test). " +
        "Nicht docker compose -p dokunc down: das hielte die andere Installation an (docs/admin/compose-project.md)\n",
    );

    const fest = run(dir, ["--festschreiben"], env);
    expect(fest.status, fest.stderr).toBe(0);
    expect(lesen(join(dir, ".env"))).toContain("COMPOSE_PROJECT_NAME=wiki-test\n");
    expect(run(dir, [], env).status).toBe(0);
  });

  it("meldet eine neue Installation neben einem Projekt dokunc aus einem anderen Verzeichnis", () => {
    // Frischer Klon in wiki2 ohne eigene Daten; dokunc gehoert der
    // Installation im Verzeichnis dokunc. --festschreiben ohne Namen
    // schriebe dokunc und zeigte diesen Klon auf deren Daten.
    const dir = repoIn("wiki2");
    const andere = join(tmp, "dokunc");
    mkdirSync(andere);
    const env = { FAKE_VOLUMES: volumes(["dokunc", ALT]), FAKE_CONTAINER: `dokunc=${andere}` };
    const r = run(dir, [], env);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`✗ Die Container des Compose-Projekts dokunc stammen aus einem anderen Verzeichnis (${andere})`);
    expect(r.stderr).toContain(
      "Diesem Verzeichnis einen eigenen Namen geben: mit Daten unter einem anderen Namen " +
        "./scripts/projektname.sh --festschreiben NAME, sonst COMPOSE_PROJECT_NAME=<neuer Name> in der .env.",
    );
    expect(r.stderr).not.toContain("--festschreiben (schreibt");

    const fest = run(dir, ["--festschreiben"], env);
    expect(fest.status).toBe(1);
    expect(fest.stdout).toBe("");
    expect(fest.stderr).toBe(
      `✗ Die Container des Compose-Projekts dokunc stammen aus einem anderen Verzeichnis (${andere}): ` +
        "vermutlich eine andere Installation auf diesem Host. Nichts geändert. Diesem Verzeichnis einen eigenen " +
        "Namen geben: mit Daten unter einem anderen Namen ./scripts/projektname.sh --festschreiben NAME, sonst " +
        "COMPOSE_PROJECT_NAME=<neuer Name> in der .env (docs/admin/compose-project.md)\n",
    );
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("zaehlt aeltere Daten einer anderen Installation nicht als die bisherigen dieses Verzeichnisses", () => {
    // Dieses Verzeichnis heisst dokunc und ist die juengere von zwei
    // Installationen; die aeltere laeuft als wiki in einem eigenen
    // Verzeichnis. Keine Meldung, die Aufbewahrung in backup.sh laeuft.
    const dir = repoIn("dokunc");
    const andere = join(tmp, "wiki");
    mkdirSync(andere);
    const env = {
      FAKE_VOLUMES: volumes(["wiki", ALT], ["dokunc", NEU]),
      FAKE_CONTAINER: `wiki=${andere};dokunc=${dir}`,
    };
    const r = run(dir, [], env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain(`Weitere dokunc-Projekte auf diesem Host: wiki (angelegt 2026-05-19, Container in ${andere})\n`);

    // Den Namen der anderen Installation schreibt --festschreiben nicht fest.
    const fremd = run(dir, ["--festschreiben", "wiki"], env);
    expect(fremd.status).toBe(1);
    expect(fremd.stderr).toContain(`✗ Die Container des Compose-Projekts wiki stammen aus einem anderen Verzeichnis (${andere})`);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    const eigen = run(dir, ["--festschreiben"], env);
    expect(eigen.stdout).toBe(
      "✓ COMPOSE_PROJECT_NAME=dokunc in .env eingetragen (Daten im Volume dokunc_db_data).\n",
    );
  });

  it("meldet vor dem ersten Start keine bisherigen Daten, die einer anderen Installation gehoeren", () => {
    const dir = repoIn("dokunc");
    const andere = join(tmp, "wiki");
    mkdirSync(andere);
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["wiki", ALT]), FAKE_CONTAINER: `wiki=${andere}` });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Noch keine Daten (neue Installation).");
  });

  it("zaehlt Container aus einem Verzeichnis, das es nicht mehr gibt, nicht als andere Installation", () => {
    // Umzug nach /srv/dokunc ohne down: die alten Container zeigen noch
    // auf das fruehere Verzeichnis.
    const dir = repoIn("dokunc");
    const weg = join(tmp, "altwiki-verschoben");
    const vorher = run(dir, [], { FAKE_VOLUMES: volumes(["altwiki", ALT]), FAKE_CONTAINER: `altwiki=${weg}` });
    expect(vorher.status).toBe(1);
    expect(vorher.stderr).toContain("./scripts/projektname.sh --festschreiben NAME");
    const nachher = run(dir, [], {
      FAKE_VOLUMES: volumes(["altwiki", ALT], ["dokunc", NEU]),
      FAKE_CONTAINER: `altwiki=${weg};dokunc=${dir}`,
    });
    expect(nachher.status).toBe(2);
    expect(nachher.stderr).toContain("das dokunc-Projekt altwiki (angelegt 2026-05-19) hat aber ältere.");
    expect(nachher.stderr).toContain("Rückweg: docker compose -p dokunc down (ohne -v), ./scripts/projektname.sh --festschreiben NAME,");
  });

  it("erkennt dieses Verzeichnis auch ueber einen Symlink", () => {
    // Compose vermerkt das Verzeichnis, wie es beim Aufruf hiess.
    const dir = repoIn("Wiki Alt");
    const link = join(tmp, "wiki-link");
    symlinkSync(dir, link);
    const r = run(dir, [], {
      FAKE_VOLUMES: volumes(["wikialt", ALT], ["dokunc", NEU]),
      FAKE_CONTAINER: `wikialt=${link};dokunc=${link}`,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Rückweg: docker compose -p dokunc down (ohne -v)");
  });

  it("erkennt einen Checkout, der die Installation im Projekt dokunc uebernaehme", () => {
    // Zwei Installationen auf einem Host: die aeltere liegt in einem
    // Verzeichnis dokunc, diese in wiki-test und hat ihren Namen nicht
    // festgeschrieben. Nach git pull nennt docker-compose.yml auch hier
    // dokunc; up erzeugte die Container der anderen Installation aus
    // diesem Checkout neu, samt Migrationen gegen deren Datenbank.
    const dir = repoIn("wiki-test");
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["dokunc", ALT], ["wiki-test", NEU]) });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Weitere dokunc-Projekte auf diesem Host: wiki-test (angelegt 2026-09-30)");
    expect(r.stderr).toBe(
      "✗ Dieses Verzeichnis gehörte bisher zum Compose-Projekt wiki-test (angelegt 2026-09-30), " +
        "docker-compose.yml nennt jetzt dokunc, und dieses Projekt hat eigene Daten (angelegt 2026-05-19): " +
        "vermutlich eine andere Installation auf diesem Host. docker compose up übernähme hier deren Container " +
        "und Datenbank. Festschreiben mit: ./scripts/projektname.sh --festschreiben (schreibt wiki-test). " +
        "Lief docker compose up hier schon, danach docker compose up -d hier und im Verzeichnis der anderen " +
        "Installation. Ist dokunc doch richtig: ./scripts/projektname.sh --festschreiben dokunc " +
        "(docs/admin/compose-project.md)\n",
    );

    const fest = run(dir, ["--festschreiben"], { FAKE_VOLUMES: volumes(["dokunc", ALT], ["wiki-test", NEU]) });
    expect(fest.status, fest.stderr).toBe(0);
    expect(lesen(join(dir, ".env"))).toContain("COMPOSE_PROJECT_NAME=wiki-test\n");
    expect(run(dir, [], { FAKE_VOLUMES: volumes(["dokunc", ALT], ["wiki-test", NEU]) }).status).toBe(0);
  });

  it("meldet den bisherigen Namen mit Daten auch bei gleichem Anlagedatum", () => {
    const r = run(repoIn("wiki-test"), [], { FAKE_VOLUMES: volumes(["dokunc", NEU], ["wiki-test", NEU]) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("übernähme hier deren Container und Datenbank");
  });

  it("zaehlt den bisherigen Namen mit Daten auch ohne die Labels von Compose", () => {
    // Von Hand angelegte und zurueckgespielte Volumes tragen keine Labels.
    const dir = repoIn("Wiki Alt");
    const ohneLabel = "wikialt_db_data wikialt_redis_data wikialt_uploads wikialt_app_data";
    const vorher = run(dir, [], { FAKE_VOLUMES: volumes(["wikialt", ALT]), FAKE_OHNE_LABEL: ohneLabel });
    expect(vorher.status).toBe(1);
    expect(vorher.stderr).toContain("Vermutlich hiess das Projekt bisher wikialt (Name des Verzeichnisses).");
    const nachher = run(dir, [], {
      FAKE_VOLUMES: volumes(["wikialt", ALT], ["dokunc", NEU]),
      FAKE_OHNE_LABEL: ohneLabel,
    });
    expect(nachher.status).toBe(2);
    expect(nachher.stderr).toContain("das dokunc-Projekt wikialt (angelegt 2026-05-19) hat aber ältere.");
  });

  it("vergleicht die Anlagedaten auch mit BSD date (macOS)", () => {
    // Umzug nach /srv/dokunc: der Verzeichnisname hilft nicht, nur das
    // Alter zeigt die neue, leere Instanz. Docker meldet die Zeit in der
    // Zone des Dienstes, auch mit Versatz.
    const dir = repoIn("dokunc");
    bsdDatum(dir);
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["altwiki", "2026-05-19T10:00:00+02:00"], ["dokunc", NEU]) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("das dokunc-Projekt altwiki (angelegt 2026-05-19) hat aber ältere.");
  });

  it("nennt ein Anlagedatum, das sich nicht lesen laesst", () => {
    const dir = repoIn("dokunc");
    bsdDatum(dir);
    const r = run(dir, [], {
      FAKE_VOLUMES: volumes(["altwiki", ALT], ["dokunc", NEU]),
      FAKE_DATUM_KAPUTT: "1",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe(
      "Hinweis: Das Anlagedatum von dokunc (2026-09-30T10:00:00Z) lässt sich nicht lesen; ob ein anderes " +
        "dokunc-Projekt ältere Daten hat, bleibt ungeprüft. Den Namen festschreiben, wenn hier mehrere " +
        "Installationen laufen (docs/admin/compose-project.md).\n",
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
    expect(bestand.stdout).toContain("Daten: vorhanden (dokunc_db_data, angelegt 2026-05-19)");
    expect(bestand.stderr).toBe("");
  });

  it("zaehlt fremde Projekte, die nur db_data haben, nicht mit", () => {
    const dir = repoIn("Wiki Alt");
    const r = run(dir, [], { FAKE_VOLUMES: `ci_db_data=${ALT} g6probe_db_data=${ALT}` });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("Weitere");
  });

  it.each([
    ["app_data und db_data", "nextcloud", ["app_data", "db_data"]],
    ["db_data, redis_data und app_data, ohne uploads", "gitea", ["db_data", "redis_data", "app_data"]],
    ["db_data, uploads und app_data, ohne redis_data", "cms", ["db_data", "uploads", "app_data"]],
  ])("zaehlt fremde Compose-Apps mit %s nicht mit", (_fall, projekt, arten) => {
    // Das sind uebliche Namen; erst db_data, redis_data und uploads
    // zusammen machen ein Projekt zu einer dokunc-Installation.
    const fremd = arten.map((art) => `${projekt}_${art}=${ALT}`).join(" ");
    const neu = run(repoIn("dokunc"), [], { FAKE_VOLUMES: fremd });
    expect(neu.status).toBe(0);
    expect(neu.stderr).toBe("");
    expect(neu.stdout).toBe("Compose-Projekt: dokunc (aus docker-compose.yml)\nNoch keine Daten (neue Installation).\n");
    const bestand = run(repoIn("dokunc"), [], { FAKE_VOLUMES: `${fremd} ${volumes(["dokunc", NEU])}` });
    expect(bestand.status).toBe(0);
    expect(bestand.stderr).toBe("");
    expect(bestand.stdout).not.toContain("Weitere");
  });

  it("schlaegt den Namen von Hand vor, wenn er nicht der des Verzeichnisses ist", () => {
    // Nach einem Umzug nach /srv/dokunc hilft der Verzeichnisname nicht.
    const dir = repoIn("dokunc");
    const r = run(dir, [], { FAKE_VOLUMES: volumes(["altwiki", ALT]) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("wohl aber für: altwiki (angelegt 2026-05-19).");
    expect(r.stderr).toContain("./scripts/projektname.sh --festschreiben NAME");
  });

  it("expandiert Arrays so, dass bash vor 4.4 (macOS) mit set -u nicht abbricht", () => {
    // Bis bash 4.3 bricht "\${a[@]}" eines leeren Arrays unter set -u mit
    // "unbound variable" ab; macOS bringt bash 3.2 mit. Die Tests laufen
    // mit einer neueren bash und saehen das nicht, deshalb diese Regel:
    // jede Expansion eines Arrays steht in der Form \${a[@]+"\${a[@]}"}.
    const quelle = readFileSync(
      fileURLToPath(new URL("../../../scripts/projektname.sh", import.meta.url)),
      "utf8",
    );
    const ungeschuetzt = [...quelle.matchAll(/\$\{(\w+)\[([@*])\]\}/g)]
      .filter((m) => !quelle.slice(0, m.index).endsWith(`\${${m[1]}[${m[2]}]+"`))
      .map((m) => `Zeile ${quelle.slice(0, m.index).split("\n").length}: ${m[0]}`);
    expect(ungeschuetzt).toEqual([]);
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

describe("scripts/projektname.sh: Installationen aus der Zeit vor dem Volume app_data", () => {
  // Bis zur Fassung mit app_data legte Compose nur db_data, redis_data,
  // uploads und die Volumes von Caddy an. app_data entsteht erst beim
  // ersten Start mit einer neueren Fassung, also genau nach dem Schritt,
  // den das Skript vorher erkennen muss.
  const VOR = "2026-06-01T08:00:00Z";

  it("erkennt den bisherigen Namen vor dem ersten Start und schreibt ihn fest", () => {
    const dir = repoIn("wiki");
    const env = { FAKE_VOLUMES: volumesVorAppData(["wiki", VOR]), FAKE_CONTAINER: `wiki=${dir}` };
    const r = run(dir, [], env);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Noch keine Daten (neue Installation).");
    expect(r.stderr).toBe(
      "✗ Für das Compose-Projekt dokunc gibt es keine Daten, wohl aber für: wiki (angelegt 2026-06-01). " +
        "Vermutlich hiess das Projekt bisher wiki (Name des Verzeichnisses). Festschreiben mit: " +
        "./scripts/projektname.sh --festschreiben (docs/admin/compose-project.md)\n",
    );

    const fest = run(dir, ["--festschreiben"], env);
    expect(fest.status, fest.stderr).toBe(0);
    expect(fest.stdout).toBe("✓ COMPOSE_PROJECT_NAME=wiki in .env eingetragen (Daten im Volume wiki_db_data).\n");
    expect(lesen(join(dir, ".env"))).toContain("COMPOSE_PROJECT_NAME=wiki\n");
    const danach = run(dir, [], env);
    expect(danach.status, danach.stderr).toBe(0);
    expect(danach.stdout).toContain("Daten: vorhanden (wiki_db_data, angelegt 2026-06-01)");
  });

  it("nimmt den Namen auch von Hand", () => {
    const dir = repoIn("wiki");
    const r = run(dir, ["--festschreiben", "wiki"], {
      FAKE_VOLUMES: volumesVorAppData(["wiki", VOR]),
      FAKE_CONTAINER: `wiki=${dir}`,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(lesen(join(dir, ".env"))).toContain("COMPOSE_PROJECT_NAME=wiki\n");
  });

  it("erkennt nach einem Start ohne Festschreiben die neue, leere Instanz", () => {
    // Nur die neue Instanz hat app_data. Exit 2: backup.sh loescht nichts.
    const dir = repoIn("wiki");
    const r = run(dir, [], {
      FAKE_VOLUMES: `${volumesVorAppData(["wiki", VOR])} ${volumes(["dokunc", NEU])}`,
      FAKE_CONTAINER: `wiki=${dir};dokunc=${dir}`,
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Weitere dokunc-Projekte auf diesem Host: wiki (angelegt 2026-06-01)\n");
    expect(r.stderr).toContain("das dokunc-Projekt wiki (angelegt 2026-06-01) hat aber ältere.");
    expect(r.stderr).toContain("Rückweg: docker compose -p dokunc down (ohne -v), ./scripts/projektname.sh --festschreiben,");
  });

  it("erkennt sie auch unter einem Namen, der nicht der des Verzeichnisses ist", () => {
    // Nach einem Umzug nach /srv/dokunc: nur die Volumes zeigen das Projekt.
    const dir = repoIn("dokunc");
    const vorher = run(dir, [], { FAKE_VOLUMES: volumesVorAppData(["altwiki", VOR]) });
    expect(vorher.status).toBe(1);
    expect(vorher.stderr).toContain("wohl aber für: altwiki (angelegt 2026-06-01).");
    expect(vorher.stderr).toContain("./scripts/projektname.sh --festschreiben NAME");
    const nachher = run(dir, [], {
      FAKE_VOLUMES: `${volumesVorAppData(["altwiki", VOR])} ${volumes(["dokunc", NEU])}`,
      FAKE_CONTAINER: `dokunc=${dir}`,
    });
    expect(nachher.status).toBe(2);
    expect(nachher.stderr).toContain("das dokunc-Projekt altwiki (angelegt 2026-06-01) hat aber ältere.");
  });
});

describe("scripts/projektname.sh: Festschreiben", () => {
  it("schreibt den bisherigen Namen in eine neue .env, nur fuer den Eigentuemer, und aendert beim zweiten Lauf nichts", () => {
    const dir = repoIn("Wiki Alt");
    const env = { FAKE_VOLUMES: volumes(["wikialt", ALT]) };
    const r = run(dir, ["--festschreiben"], env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(
      "✓ COMPOSE_PROJECT_NAME=wikialt in .env eingetragen (Daten im Volume wikialt_db_data).\n",
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

  it("folgt einer Kette relativer Symlinks auch ohne readlink -f (macOS vor 12.3)", () => {
    const dir = repoIn("Wiki Alt");
    readlinkOhneF(dir);
    mkdirSync(join(tmp, "geheim/tief"), { recursive: true });
    const ziel = join(tmp, "geheim/tief/wiki.env");
    writeFileSync(ziel, "APP_SECRET=x\n");
    chmodSync(ziel, 0o640);
    symlinkSync("tief/wiki.env", join(tmp, "geheim/aktuell.env"));
    symlinkSync("../geheim/aktuell.env", join(dir, ".env"));
    const r = run(dir, ["--festschreiben"], { FAKE_VOLUMES: volumes(["wikialt", ALT]) });
    expect(r.status, r.stderr).toBe(0);
    expect(lstatSync(join(dir, ".env")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(tmp, "geheim/aktuell.env")).isSymbolicLink()).toBe(true);
    expect(lesen(ziel)).toBe(
      "APP_SECRET=x\n# Compose-Projekt dieser Installation (scripts/projektname.sh)\nCOMPOSE_PROJECT_NAME=wikialt\n",
    );
    expect(modus(ziel)).toBe(0o640);

    // Ein Kreis endet mit Exit 3, ohne etwas zu schreiben.
    const kreis = repoIn("Wiki Kreis");
    readlinkOhneF(kreis);
    symlinkSync("b.env", join(kreis, ".env.a"));
    symlinkSync(".env.a", join(kreis, "b.env"));
    symlinkSync(".env.a", join(kreis, ".env"));
    const k = run(kreis, ["--festschreiben"], { FAKE_VOLUMES: volumes(["wikikreis", ALT]) });
    expect(k.status).toBe(3);
    expect(k.stderr).toBe("✗ .env: zu viele Symlinks hintereinander.\n");
  });

  it("endet mit Exit 3, wenn die .env nicht neu angelegt werden kann", () => {
    // Die .env zeigt in einen Ordner, den es nicht gibt (etwa ein nicht
    // eingehaengtes Laufwerk). Als root der einzige Weg, das Anlegen
    // scheitern zu lassen.
    const dir = repoIn("Wiki Alt");
    symlinkSync(join(tmp, "nicht-eingehaengt/wiki.env"), join(dir, ".env"));
    const r = run(dir, ["--festschreiben"], { FAKE_VOLUMES: volumes(["wikialt", ALT]) });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      /^✗ \.env nicht schreibbar \(\S+\/nicht-eingehaengt\/wiki\.env\)\. Nichts geändert\.\n {2}\S.*No such file or directory\n$/,
    );
  });

  it("endet mit Exit 3, wenn die Kopie der .env scheitert", () => {
    // bin/cp scheitert wie in einem Ordner ohne Schreibrecht.
    const dir = repoIn("Wiki Alt");
    const datei = join(dir, ".env");
    writeFileSync(datei, "APP_SECRET=x\n");
    writeFileSync(
      join(dir, "bin/cp"),
      `#!/usr/bin/env bash\necho "cp: cannot create regular file '\${2:-}': Permission denied" >&2\nexit 1\n`,
    );
    chmodSync(join(dir, "bin/cp"), 0o755);
    const r = run(dir, ["--festschreiben"], { FAKE_VOLUMES: volumes(["wikialt", ALT]) });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("✗ .env nicht schreibbar (.env). Nichts geändert.\n  cp: cannot create regular file");
    expect(lesen(datei)).toBe("APP_SECRET=x\n");
  });

  it.skipIf(process.getuid?.() === 0)("endet mit Exit 3 in einem Ordner ohne Schreibrecht (nicht als root)", () => {
    const dir = repoIn("Wiki Alt");
    const ordner = join(tmp, "nur-lesen");
    mkdirSync(ordner);
    writeFileSync(join(ordner, "wiki.env"), "APP_SECRET=x\n");
    symlinkSync(join(ordner, "wiki.env"), join(dir, ".env"));
    chmodSync(ordner, 0o555);
    try {
      const r = run(dir, ["--festschreiben"], { FAKE_VOLUMES: volumes(["wikialt", ALT]) });
      expect(r.status).toBe(3);
      expect(r.stderr).toContain("✗ .env nicht schreibbar");
      expect(lesen(join(ordner, "wiki.env"))).toBe("APP_SECRET=x\n");
    } finally {
      chmodSync(ordner, 0o755);
    }
  });

  it("schreibt den aktuellen Namen, wenn es keinen bisherigen mit Daten gibt", () => {
    const bestand = repoIn("dokunc");
    const r = run(bestand, ["--festschreiben"], { FAKE_VOLUMES: volumes(["dokunc", ALT]) });
    expect(r.stdout).toContain("✓ COMPOSE_PROJECT_NAME=dokunc in .env eingetragen (Daten im Volume dokunc_db_data).");
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

describe("scripts/projektname.sh: ohne Zugriff auf Docker", () => {
  // docker compose config braucht den Docker-Dienst nicht, die Abfragen
  // der Volumes schon. Ohne Zugriff (ein Benutzer ohne Rechte am Socket,
  // wo docker compose sonst mit sudo laeuft) saehe jede Installation wie
  // eine neue aus, und --festschreiben schriebe den falschen Namen fest.
  const env = { FAKE_VOLUMES: volumes(["wikialt", ALT]) };

  it.each(["alle", "ls", "inspect", "ps"])("bricht die Pruefung ab, statt eine neue Installation zu melden (%s)", (weg) => {
    const r = run(repoIn("Wiki Alt"), [], { ...env, FAKE_DOCKER_WEG: weg });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe("Compose-Projekt: dokunc (aus docker-compose.yml)\n");
    expect(r.stderr).toMatch(/^✗ docker (volume ls|volume inspect \S+|ps -a) gescheitert: ohne Zugriff auf Docker/);
    expect(r.stderr).toContain("  permission denied while trying to connect to the docker API");
  });

  it.each([
    ["alle", "Wiki Alt", []],
    ["inspect", "Wiki Alt", []],
    ["alle", "dokunc", []],
    ["inspect", "dokunc", ["wikialt"]],
    ["ps", "Wiki Alt", []],
    ["ps", "dokunc", ["wikialt"]],
  ])("schreibt nichts fest (%s, Verzeichnis %s, Name %j)", (weg, verzeichnis, name) => {
    const dir = repoIn(verzeichnis);
    const datei = join(dir, ".env");
    writeFileSync(datei, "APP_SECRET=x\n");
    const r = run(dir, ["--festschreiben", ...name], { ...env, FAKE_DOCKER_WEG: weg });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("gescheitert: ohne Zugriff auf Docker");
    expect(lesen(datei)).toBe("APP_SECRET=x\n");
  });

  it("nennt den Namen auch ohne Docker (--name)", () => {
    const r = run(repoIn("Wiki Alt"), ["--name"], { FAKE_DOCKER_WEG: "alle" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("dokunc\n");
  });
});
