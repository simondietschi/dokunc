import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { MAX_LAENGE, pruefeTitel, TYPEN } from "../../../.github/scripts/pr-title.mjs";

/**
 * Konventionen fuer Beitraege (CONTRIBUTING.md): die Titelpruefung fuer
 * Pull-Requests (.github/scripts/pr-title.mjs), ihr Workflow und die
 * Titel, die Dependabot erzeugt.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKRIPT = join(ROOT, ".github/scripts/pr-title.mjs");
const DEPENDABOT = "dependabot[bot]";

function lesen(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

type Schritt = { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Workflow = {
  on: Record<string, { types?: string[] } | null>;
  permissions?: unknown;
  jobs: Record<string, { steps?: Schritt[] }>;
};

/** Startet das Skript wie der Workflow: nur mit PATH, Titel und Autor. */
function aufruf(titel: string, autor = "jemand") {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", PR_TITLE: titel, PR_AUTHOR: autor };
  const r = spawnSync(process.execPath, [SKRIPT], { env: env as NodeJS.ProcessEnv, encoding: "utf8" });
  return { code: r.status, zeilen: r.stdout.split("\n").filter((z) => z !== "") };
}

describe("Konventionen", () => {
  it.each([
    "fix(collab): keep edits when Redis restarts",
    "feat!: require Node 26",
    "feat(api)!: drop v0 tokens",
    "ci: add CodeQL code scanning",
    "chore(deps-dev): bump the eslint group across 1 directory with 2 updates",
    "fix(deps): bump the other group across 1 directory with 12 updates",
    // Dependabot schreibt "bump" je nach Historie gross; die Beschreibung
    // darf mit einem Grossbuchstaben beginnen
    "fix(deps): Bump next from 16.3.6 to 16.3.7",
    "chore(deps-dev): [security] bump vite from 8.0.1 to 8.0.2",
    "revert: fix(web): show the SSO button again",
    "docs(contributing): describe branch names",
    "fix: " + "a".repeat(95),
  ])("PR-Titel: gueltig %s", (titel) => {
    expect(pruefeTitel(titel)).toEqual([]);
  });

  it.each([
    // Betreffe aus der Historie dieses Repositorys
    ["Folgepunkte: Suchparameter ohne Serverfehler", 'Unknown type "Folgepunkte"'],
    ["Punkt 4: Nacharbeit nach Pruefung", "must look like"],
    // Dependabot ohne commit-message in dependabot.yml
    ["Bump mermaid from 11.16.1 to 12.0.0", "must look like"],
    [
      "Chore(deps-dev): Bump @types/node from 26.6.2 to 26.6.3 in the uebrige group across 1 directory",
      'Unknown type "Chore"',
    ],
    ["Fix(collab): keep edits", 'Unknown type "Fix"'],
    ["feature: add x", 'Unknown type "feature"'],
    ["fix(Collab): keep edits", "The scope"],
    ["fix(): x", "The scope"],
    ["fix(web collab): x", "The scope"],
    ["fix(collab) keep edits", "must look like"],
    ["fix:keep edits", "must look like"],
    ["fix: ", "is missing"],
    ["fix:  keep edits", "start or end with a space"],
    ["fix: keep edits ", "start or end with a space"],
    ["fix: ends with period.", "full stop"],
    // Vorschlag des Revert-Knopfs von GitHub
    ['Revert "fix(web): show the SSO button again"', "revert: <title"],
  ])("PR-Titel: ungueltig %s", (titel, teil) => {
    const fehler = pruefeTitel(titel);
    expect(fehler.join("\n")).toContain(teil);
  });

  it("PR-Titel: hoechstens 100 Codepoints, ausser bei Dependabot", () => {
    expect(MAX_LAENGE).toBe(100);
    expect(pruefeTitel("fix: " + "a".repeat(96))).toEqual([
      "The title has 101 characters; keep it at 100 or fewer.",
    ]);
    // 100 Codepoints, aber 195 UTF-16-Einheiten
    expect(pruefeTitel("fix: " + "😀".repeat(95))).toEqual([]);
    // Dependabot kuerzt seine Titel nicht (eine Gruppe mit einem Update
    // kommt auf 106 Zeichen, mit [security] auf 110); fuer ihn entfaellt
    // nur die Laenge, nicht die Form.
    const lang =
      "chore(deps-dev): [security] bump eslint-plugin-react-hooks from 7.1.1 to 7.2.0 in the eslint group across 1 directory";
    expect([...lang].length).toBeGreaterThan(100);
    expect(pruefeTitel(lang).join("\n")).toContain("keep it at 100 or fewer");
    expect(pruefeTitel(lang, { autor: DEPENDABOT })).toEqual([]);
    expect(pruefeTitel("Bump x from 1.0.0 to 1.0.1", { autor: DEPENDABOT }).join("\n")).toContain(
      "must look like",
    );
  });

  it("PR-Titel-Workflow: Skript vom Zielbranch, alle Ereignisse, nur Leserecht, Titel nur ueber env", () => {
    const wf = parse(lesen(".github/workflows/pr-title.yml")) as Workflow;
    // pull_request_target: Workflow und Skript kommen vom Zielbranch. Mit
    // pull_request liefe das Skript aus dem Pull-Request, der es aendern
    // und so seine eigene Pruefung bestehen koennte.
    expect(Object.keys(wf.on)).toEqual(["pull_request_target"]);
    expect(wf.on.pull_request_target?.types).toEqual(
      expect.arrayContaining(["opened", "edited", "reopened", "synchronize"]),
    );
    expect(wf.permissions).toEqual({ contents: "read" });
    const schritte = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
    for (const s of schritte) {
      // Kein Ausdruck in run: ein Titel wie 'fix: $(curl …)' liefe sonst
      // als Befehl
      expect(s.run ?? "", s.name).not.toContain("${{");
      if (s.uses !== undefined) {
        // Im Kontext von pull_request_target nur der Checkout, und der nie
        // mit einem ref: aus dem Pull-Request
        expect(s.uses, s.name).toMatch(/^actions\/checkout@/);
        expect(s.with?.ref, s.uses).toBeUndefined();
        expect(s.with?.["persist-credentials"], s.uses).toBe(false);
      }
    }
    const pruefung = schritte.filter((s) => (s.run ?? "").includes(".github/scripts/pr-title.mjs"));
    expect(pruefung).toHaveLength(1);
    expect(pruefung[0].run?.trim()).toBe("node .github/scripts/pr-title.mjs");
    expect(pruefung[0].env).toEqual({
      PR_TITLE: "${{ github.event.pull_request.title }}",
      PR_AUTHOR: "${{ github.event.pull_request.user.login }}",
    });
  });

  it("PR-Titel-Skript: Aufruf wie im Workflow, Meldungen als maskierte Workflow-Befehle", () => {
    const gut = aufruf("ci: check pull request titles against Conventional Commits");
    expect(gut.code).toBe(0);
    expect(gut.zeilen).toEqual(["The pull request title follows Conventional Commits."]);

    const schlecht = aufruf("Bump x");
    expect(schlecht.code).toBe(1);
    expect(schlecht.zeilen[0]).toMatch(/^::error title=Pull request title::The title must look like/);
    expect(schlecht.zeilen.at(-1)).toContain("CONTRIBUTING.md");
    // Der Titel selbst erscheint nie in der Ausgabe
    expect(schlecht.zeilen.join("\n")).not.toContain("Bump x");

    // % im geprueften Teil wird maskiert: der Runner dekodiert %25 zurueck
    // zu %, aus "%0A" wird also kein Zeilenumbruch
    const typ = aufruf("fe%0Aat: add x");
    expect(typ.code).toBe(1);
    expect(typ.zeilen[0]).toBe(
      `::error title=Pull request title::Unknown type "fe%250Aat". Use one of: ${TYPEN.join(", ")}.`,
    );

    const lang = `fix(deps): bump ${"a".repeat(100)} from 1.0.0 to 1.0.1`;
    expect(aufruf(lang, DEPENDABOT).code).toBe(0);
    expect(aufruf(lang).code).toBe(1);
  });

  it("Dependabot: jeder Vorschlag besteht die Titelpruefung", () => {
    type Update = {
      "package-ecosystem": string;
      "commit-message"?: { prefix?: string; "prefix-development"?: string; include?: string };
      groups?: Record<string, { patterns?: string[] }>;
    };
    const updates = (parse(lesen(".github/dependabot.yml")) as { updates: Update[] }).updates;

    // Alle Pakete des Workspaces, fuer den laengsten realistischen Titel je
    // Gruppe
    const pakete = new Set<string>();
    const manifeste = [
      "package.json",
      ...["apps", "packages"].flatMap((d) =>
        readdirSync(join(ROOT, d)).map((p) => `${d}/${p}/package.json`),
      ),
    ];
    for (const m of manifeste) {
      let json: Record<string, Record<string, string> | undefined>;
      try {
        json = JSON.parse(lesen(m));
      } catch {
        continue;
      }
      for (const feld of ["dependencies", "devDependencies"]) {
        for (const name of Object.keys(json[feld] ?? {})) pakete.add(name);
      }
    }
    expect(pakete.size).toBeGreaterThan(10);
    const passt = (muster: string, name: string) =>
      new RegExp(`^${muster.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(name);

    for (const u of updates) {
      const oeko = u["package-ecosystem"];
      const cm = u["commit-message"];
      expect(cm?.include, oeko).toBe("scope");
      expect(cm?.prefix, oeko).toBeTruthy();
      const praefixe: [string, string][] = [[cm?.prefix ?? "", "deps"]];
      if (oeko === "npm") {
        expect(cm?.["prefix-development"], oeko).toBeTruthy();
        praefixe.push([cm?.["prefix-development"] ?? "", "deps-dev"]);
      }
      const titel: string[] = [];
      for (const [p, scope] of praefixe) {
        titel.push(`${p}(${scope}): bump example from 1.0.0 to 1.1.0`);
        titel.push(`${p}(${scope}): [security] bump example from 1.0.0 to 1.1.0`);
        for (const [gruppe, g] of Object.entries(u.groups ?? {})) {
          const namen = [...pakete].filter((n) => (g.patterns ?? []).some((m) => passt(m, n)));
          const laengster = namen.sort((a, b) => b.length - a.length)[0] ?? "example";
          titel.push(`${p}(${scope}): bump the ${gruppe} group across 1 directory with 12 updates`);
          titel.push(
            `${p}(${scope}): [security] bump ${laengster} from 10.100.1000 to 10.100.1001 in the ${gruppe} group across 1 directory`,
          );
        }
      }
      for (const t of titel) {
        expect(pruefeTitel(t, { autor: DEPENDABOT }), t).toEqual([]);
      }
    }
  });

  it("CONTRIBUTING: dieselben Typen und dieselbe Laenge wie die Pruefung", () => {
    const text = lesen("CONTRIBUTING.md");
    const typen = [...text.matchAll(/^\| `([a-z]+)` \|/gm)].map((m) => m[1]);
    expect([...typen].sort()).toEqual([...TYPEN].sort());
    expect(text).toContain(`at most ${MAX_LAENGE} characters`);
    // Die Regel fuer parallele Zweige steht dort, wo Beitragende sie lesen
    expect(text).toContain("merge=union");
    expect(lesen(".gitattributes")).toMatch(/^CHANGELOG\.md merge=union$/m);
  });
});
