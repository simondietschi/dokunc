import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  AUSSERHALB_VARIABLEN,
  GEMEINSAME_VARIABLEN,
  NOCH_OHNE_SCHEMA,
  type Variable,
} from "@dokunc/config";
import { NUR_WEB_VARIABLEN, WEB_VARIABLEN } from "@/lib/config/variablen";
import {
  COLLAB_VARIABLEN,
  NUR_COLLAB_VARIABLEN,
} from "../../collab/src/config-variablen";

/**
 * Gleichlauf von Konfigurationsschema, .env.example und Compose.
 *
 * Jede Variable, die eine Installation setzen kann, ist entweder
 * deklariert (packages/config, apps/web/src/lib/config/variablen.ts,
 * apps/collab/src/config-variablen.ts) oder steht in der Liste der
 * bestehenden, noch ungeprueften Variablen. Eine neue Variable ohne
 * Deklaration faellt hier auf, ebenso eine deklarierte, die in
 * .env.example oder unter app.environment fehlt. Wie eine Variable
 * dazukommt: packages/config/README.md.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function lesen(datei: string): string {
  return readFileSync(join(ROOT, datei), "utf8");
}

/**
 * Die Compose-Dateien des Repos. docker-compose.override.yml ist die
 * eigene, nicht versionierte Datei eines Betreibers oder Entwicklers
 * (.gitignore); ihre Variablen gehoeren nicht ins Schema.
 */
export function composeDateien(namen: readonly string[]): string[] {
  return namen.filter(
    (d) => /^docker-compose.*\.ya?ml$/.test(d) && !/^docker-compose\.override\.ya?ml$/.test(d),
  );
}

const COMPOSE_DATEIEN = composeDateien(readdirSync(ROOT));

/** `NAME=` oder `# NAME=` am Zeilenanfang. */
export function namenAusEnvBeispiel(text: string): Set<string> {
  const namen = new Set<string>();
  for (const z of text.split("\n")) {
    const m = /^(?:# ?)?([A-Z][A-Z0-9_]*)=/.exec(z);
    if (m) namen.add(m[1]);
  }
  return namen;
}

/** `${NAME}`, `${NAME:-…}` usw., ohne die mit $$ maskierten. */
export function namenAusCompose(text: string): Set<string> {
  return new Set([...text.matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
}

function appUmgebung(): Set<string> {
  const compose = parse(lesen("docker-compose.yml")) as {
    services: { app: { environment: Record<string, unknown> } };
  };
  return new Set(Object.keys(compose.services.app.environment));
}

const envBeispiel = namenAusEnvBeispiel(lesen(".env.example"));
const composeNamen = new Set(COMPOSE_DATEIEN.flatMap((d) => [...namenAusCompose(lesen(d))]));
const appEnv = appUmgebung();
const vorkommen = new Set([...envBeispiel, ...composeNamen, ...appEnv]);

const LISTEN: Record<string, readonly Variable[]> = {
  "packages/config/src/variablen/gemeinsam.ts": GEMEINSAME_VARIABLEN,
  "packages/config/src/variablen/ausserhalb.ts": AUSSERHALB_VARIABLEN,
  "apps/web/src/lib/config/variablen.ts": NUR_WEB_VARIABLEN,
  "apps/collab/src/config-variablen.ts": NUR_COLLAB_VARIABLEN,
};
const deklariert = Object.values(LISTEN).flat();
const deklarierteNamen = new Set(deklariert.map((v) => v.name));

/**
 * Namen, deren Wert ein Geheimnis ist. Ausnahmen mit Grund: ein Pfad und
 * eine Zahl, die nur zufaellig TOKEN im Namen tragen.
 */
const NICHT_GEHEIM_TROTZ_NAMEN: Record<string, string> = {
  SETUP_TOKEN_FILE: "Pfad zur Datei, nicht das Token",
  TOKEN_RETENTION_DAYS: "Anzahl Tage",
};

export function mussGeheimSein(name: string): boolean {
  if (name in NICHT_GEHEIM_TROTZ_NAMEN) return false;
  return (
    /_(SECRET|PASSWORD|KEY)$/.test(name) ||
    name.includes("TOKEN") ||
    ["DATABASE_URL", "REDIS_URL", "SHADOW_DATABASE_URL"].includes(name)
  );
}

function sortiert(namen: readonly string[]): boolean {
  return namen.every((n, i) => i === 0 || namen[i - 1] < n);
}

describe("Konfigurationsschema und Konfigurationsdateien", () => {
  it("kennt jede Variable aus .env.example und den Compose-Dateien", () => {
    const fremd = [...vorkommen]
      .filter((n) => !deklarierteNamen.has(n) && !NOCH_OHNE_SCHEMA.includes(n))
      .map(
        (n) =>
          `${n} steht in .env.example/Compose, aber nicht im Konfigurationsschema. Deklarieren (packages/config/README.md).`,
      );
    expect(fremd).toEqual([]);
  });

  it("fuehrt keine Variable zugleich als deklariert und als ungeprueft", () => {
    expect(NOCH_OHNE_SCHEMA.filter((n) => deklarierteNamen.has(n))).toEqual([]);
  });

  it("hat jede deklarierte Variable in .env.example und, fuer die Server, unter app.environment", () => {
    const fehlt: string[] = [];
    for (const v of deklariert) {
      if (!envBeispiel.has(v.name)) fehlt.push(`${v.name} fehlt in .env.example`);
      const server = v.dienste.includes("web") || v.dienste.includes("collab");
      if (server && v.inCompose !== false && !appEnv.has(v.name)) {
        fehlt.push(`${v.name} fehlt unter services.app.environment in docker-compose.yml`);
      }
    }
    expect(fehlt).toEqual([]);
  });

  it("haelt die Liste der ungeprueften Variablen sortiert und ohne verschwundene Namen", () => {
    expect(sortiert(NOCH_OHNE_SCHEMA)).toBe(true);
    expect(NOCH_OHNE_SCHEMA.filter((n) => !vorkommen.has(n))).toEqual([]);
  });

  it("haelt jede Deklarationsliste nach Namen sortiert", () => {
    for (const [datei, liste] of Object.entries(LISTEN)) {
      expect(sortiert(liste.map((v) => v.name)), datei).toBe(true);
    }
  });

  it("deklariert jeden Namen einmal, in gueltiger Form, mit Beschreibung", () => {
    const namen = deklariert.map((v) => v.name);
    expect(namen.filter((n, i) => namen.indexOf(n) !== i)).toEqual([]);
    for (const v of deklariert) {
      expect(v.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(v.beschreibung.trim(), v.name).not.toBe("");
      expect(v.dienste.length, v.name).toBeGreaterThan(0);
    }
  });

  it("markiert Geheimnisse als geheim", () => {
    const offen = deklariert.filter((v) => mussGeheimSein(v.name) && v.geheim !== true);
    expect(offen.map((v) => v.name)).toEqual([]);
  });

  it("prueft in jedem Server alle gemeinsamen Variablen seines Dienstes", () => {
    for (const v of GEMEINSAME_VARIABLEN) {
      expect(WEB_VARIABLEN.includes(v)).toBe(v.dienste.includes("web"));
      expect(COLLAB_VARIABLEN.includes(v)).toBe(v.dienste.includes("collab"));
    }
    expect(WEB_VARIABLEN.every((v) => v.dienste.includes("web"))).toBe(true);
    expect(COLLAB_VARIABLEN.every((v) => v.dienste.includes("collab"))).toBe(true);
  });
});

describe("Hilfen des Gleichlauftests", () => {
  it("liest Namen aus .env.example, auch auskommentierte", () => {
    const text = ['A="1"', "# B=2", "#   C=3", "# Text mit D=4", "E_2=", "f=1"].join("\n");
    expect([...namenAusEnvBeispiel(text)]).toEqual(["A", "B", "E_2"]);
  });

  it("liest die Compose-Dateien des Repos, nicht die eigene Override-Datei", () => {
    const namen = [
      "docker-compose.yml",
      "docker-compose.domain.yml",
      "docker-compose.override.yml",
      "docker-compose.override.yaml",
      "compose.yml",
      "README.md",
    ];
    expect(composeDateien(namen)).toEqual(["docker-compose.yml", "docker-compose.domain.yml"]);
  });

  it("liest Namen aus Compose, ohne maskierte", () => {
    const text = 'X: ${A:-1}\nY: "${B}"\nZ: "$${C}"\nW: ${D?fehlt}';
    expect([...namenAusCompose(text)]).toEqual(["A", "B", "D"]);
  });

  it("erkennt Geheimnisse am Namen, mit den begruendeten Ausnahmen", () => {
    for (const n of ["APP_SECRET", "SMTP_PASSWORD", "VOYAGE_API_KEY", "DATABASE_URL", "REDIS_URL", "SHADOW_DATABASE_URL", "SETUP_TOKEN", "API_TOKEN_X"]) {
      expect(mussGeheimSein(n), n).toBe(true);
    }
    for (const n of ["SETUP_TOKEN_FILE", "TOKEN_RETENTION_DAYS", "LOG_LEVEL", "APP_URL", "KEY_ROTATION_DAYS"]) {
      expect(mussGeheimSein(n), n).toBe(false);
    }
  });
});
