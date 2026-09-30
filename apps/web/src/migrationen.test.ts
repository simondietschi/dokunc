import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

/**
 * Migrationen: Schema gegen Migrationen und Datenverlust.
 *
 * Eine vergessene Migration faellt erst in einer Installation auf; die
 * CI vergleicht deshalb schema.prisma mit dem Stand nach allen
 * Migrationen (pnpm --filter @dokunc/db migrate:check, in einer eigenen,
 * leeren Schattendatenbank). Hier stehen die Teile, die ohne Datenbank
 * pruefbar sind: der Befehl, der CI-Schritt, der Schutz in
 * prisma.config.ts gegen eine Schattendatenbank, die die der App ist
 * (Prisma leert sie), und die Regel gegen DROP COLUMN und DROP TABLE.
 * Prisma erzeugt fuer ein umbenanntes Feld DROP und ADD; ohne die Regel
 * ginge der Inhalt beim naechsten Update still verloren.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONEN = "packages/db/prisma/migrations";

function lesen(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

/** Pflichtzeile ueber einem gewollten DROP COLUMN oder DROP TABLE. */
const MARKIERUNG = /^--\s*Datenverlust gewollt:\s*(\S.{9,})$/;

export type Verstoss = { zeile: number; art: "DROP COLUMN" | "DROP TABLE" };

/** Code einer Anweisung ohne Kommentare, ihre Zeilen, Markierung darueber. */
type Anweisung = { code: string; zeilen: number[]; markiert: boolean };

/**
 * In ALTER TABLE ist COLUMN optional: `DROP "x"` und `DROP IF EXISTS x`
 * entfernen eine Spalte samt Inhalt. Kein Spaltenverlust sind DROP
 * CONSTRAINT und die Aenderungen einer Spalte (ALTER COLUMN x DROP
 * DEFAULT, NOT NULL, EXPRESSION, IDENTITY).
 */
const ALTER_TABLE = /^\s*ALTER\s+TABLE\b/i;
const DROP_OHNE_COLUMN = /\bDROP\s+(?!(?:COLUMN|CONSTRAINT|DEFAULT|NOT|EXPRESSION|IDENTITY)\b)/i;

/**
 * Anweisungen mit DROP COLUMN oder DROP TABLE ohne Markierung; in ALTER
 * TABLE auch DROP ohne das Wort COLUMN.
 *
 * Eine Anweisung reicht bis zum naechsten `;`, auch ueber mehrere Zeilen.
 * `--`-Kommentare zaehlen nicht als Code. Die Markierung muss im
 * Kommentarblock direkt ueber der Anweisung stehen (zusammenhaengende
 * Kommentarzeilen ohne Leerzeile dazwischen, wie Prisma sie mit
 * "-- AlterTable" erzeugt), mit einer Begruendung von mindestens zehn
 * Zeichen. Gemeldet wird die Zeile mit dem DROP.
 */
export function dropOhneMarkierung(sql: string): Verstoss[] {
  const verstoesse: Verstoss[] = [];
  let block: string[] = [];
  let anweisung: Anweisung | null = null;

  const zeilen = sql.split("\n");
  for (let i = 0; i < zeilen.length; i++) {
    const zeile = zeilen[i].trim();
    const kommentar = zeile.indexOf("--");
    const code = (kommentar >= 0 ? zeile.slice(0, kommentar) : zeile).trim();
    if (!anweisung) {
      if (code === "") {
        // Kommentarzeile: gehoert zum Block ueber der naechsten
        // Anweisung. Leerzeile: der Block endet.
        block = zeile.startsWith("--") ? [...block, zeile] : [];
        continue;
      }
      anweisung = { code: "", zeilen: [], markiert: block.some((b) => MARKIERUNG.test(b)) };
      block = [];
    }
    let rest = code;
    while (anweisung) {
      const ende = rest.indexOf(";");
      const teil = ende >= 0 ? rest.slice(0, ende) : rest;
      anweisung.code += `${teil}\n`;
      anweisung.zeilen.push(i + 1);
      if (ende < 0) break;
      pruefe(anweisung);
      rest = rest.slice(ende + 1).trim();
      // Eine zweite Anweisung in derselben Zeile hat keinen eigenen
      // Kommentarblock.
      anweisung = rest === "" ? null : { code: "", zeilen: [], markiert: false };
    }
  }
  if (anweisung) pruefe(anweisung);
  return verstoesse;

  function pruefe(a: Anweisung) {
    if (a.markiert) return;
    const treffer = [
      /\bDROP\s+(COLUMN|TABLE)\b/i.exec(a.code),
      ALTER_TABLE.test(a.code) ? DROP_OHNE_COLUMN.exec(a.code) : null,
    ]
      .filter((t) => t !== null)
      .sort((x, y) => x.index - y.index)[0];
    if (!treffer) return;
    const zeilenVorher = a.code.slice(0, treffer.index).split("\n").length - 1;
    verstoesse.push({
      zeile: a.zeilen[zeilenVorher] ?? a.zeilen[0],
      art: treffer[1]?.toUpperCase() === "TABLE" ? "DROP TABLE" : "DROP COLUMN",
    });
  }
}

function meldung(datei: string, v: Verstoss): string {
  return (
    `${datei}:${v.zeile}: ${v.art} ohne Markierung. Prisma erzeugt fuer ein umbenanntes Feld DROP und ADD, ` +
    'der Inhalt ginge verloren. Gewollt? Dann "-- Datenverlust gewollt: <Grund>" direkt darueber setzen; ' +
    "sonst die Migration von Hand als RENAME schreiben."
  );
}

describe("Migrationen ohne ungewollten Datenverlust", () => {
  it("jedes DROP COLUMN und DROP TABLE traegt die Markierung", () => {
    const ordner = readdirSync(join(ROOT, MIGRATIONEN), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(ordner.length).toBeGreaterThan(10);
    const fehler = ordner.flatMap((name) => {
      const datei = `${MIGRATIONEN}/${name}/migration.sql`;
      return dropOhneMarkierung(lesen(datei)).map((v) => meldung(datei, v));
    });
    expect(fehler).toEqual([]);
  });
});

describe("dropOhneMarkierung", () => {
  const MARKE = "-- Datenverlust gewollt: Feld wird nicht mehr gebraucht";

  it.each([
    ["mit Markierung", [MARKE, "-- AlterTable", 'ALTER TABLE "Page" DROP COLUMN "x";'], []],
    ["ohne Markierung", ["-- AlterTable", 'ALTER TABLE "Page" DROP COLUMN "x";'], [{ zeile: 2, art: "DROP COLUMN" }]],
    ["DROP TABLE, gross/klein egal", ["drop table if exists \"Alt\";"], [{ zeile: 1, art: "DROP TABLE" }]],
    ["DROP INDEX", ['DROP INDEX IF EXISTS "Page_fulltext_idx";'], []],
    ["DROP CONSTRAINT", ['ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_spaceId_fkey";'], []],
    ["nur im Kommentar", ["-- frueher: DROP COLUMN x", 'CREATE INDEX "i" ON "Page"("x");'], []],
    ["Kommentar am Zeilenende", ['CREATE INDEX "i" ON "Page"("x"); -- kein DROP TABLE'], []],
    [
      "ueber zwei Zeilen",
      ["-- AlterTable", 'ALTER TABLE "X"', '  DROP COLUMN "y";'],
      [{ zeile: 3, art: "DROP COLUMN" }],
    ],
    [
      "Markierung ueber einer anderen Anweisung",
      [MARKE, 'ALTER TABLE "A" ADD COLUMN "b" TEXT;', "", 'ALTER TABLE "A" DROP COLUMN "c";'],
      [{ zeile: 4, art: "DROP COLUMN" }],
    ],
    [
      "Leerzeile zwischen Markierung und Anweisung",
      [MARKE, "", 'ALTER TABLE "A" DROP COLUMN "c";'],
      [{ zeile: 3, art: "DROP COLUMN" }],
    ],
    [
      "Begruendung zu kurz",
      ["-- Datenverlust gewollt: weg", 'ALTER TABLE "A" DROP COLUMN "c";'],
      [{ zeile: 2, art: "DROP COLUMN" }],
    ],
    [
      "zweite Anweisung in derselben Zeile",
      [MARKE, 'ALTER TABLE "A" DROP COLUMN "c"; DROP TABLE "B";'],
      [{ zeile: 2, art: "DROP TABLE" }],
    ],
    // In ALTER TABLE ist COLUMN optional: DROP "x" entfernt die Spalte.
    ["DROP ohne COLUMN", ["-- AlterTable", 'ALTER TABLE "Page"', '  DROP "x";'], [{ zeile: 3, art: "DROP COLUMN" }]],
    ["DROP IF EXISTS ohne COLUMN", ['ALTER TABLE "Page" DROP IF EXISTS "x";'], [{ zeile: 1, art: "DROP COLUMN" }]],
    [
      "DROP ohne COLUMN nach einer anderen Aenderung",
      ['ALTER TABLE "Page" ADD COLUMN "y" TEXT,', '  DROP x;'],
      [{ zeile: 2, art: "DROP COLUMN" }],
    ],
    ["DROP ohne COLUMN mit Markierung", [MARKE, 'ALTER TABLE "Page" DROP "x";'], []],
    [
      "DROP DEFAULT, NOT NULL, EXPRESSION und IDENTITY einer Spalte",
      [
        'ALTER TABLE "Page" ALTER COLUMN "x" DROP DEFAULT,',
        '  ALTER COLUMN "y" DROP NOT NULL, ALTER "z" DROP EXPRESSION IF EXISTS;',
        'ALTER TABLE "A" ALTER COLUMN "id" DROP IDENTITY;',
      ],
      [],
    ],
    ["DROP ohne COLUMN ausserhalb von ALTER TABLE", ['DROP TYPE "Rolle";', 'DROP SEQUENCE "s";'], []],
  ] as const)("%s", (_fall, zeilen, erwartet) => {
    expect(dropOhneMarkierung(zeilen.join("\n"))).toEqual(erwartet);
  });

  it("meldet Datei, Zeile und den Ausweg", () => {
    expect(meldung("packages/db/prisma/migrations/x/migration.sql", { zeile: 3, art: "DROP COLUMN" })).toBe(
      "packages/db/prisma/migrations/x/migration.sql:3: DROP COLUMN ohne Markierung. Prisma erzeugt fuer ein " +
        'umbenanntes Feld DROP und ADD, der Inhalt ginge verloren. Gewollt? Dann "-- Datenverlust gewollt: ' +
        '<Grund>" direkt darueber setzen; sonst die Migration von Hand als RENAME schreiben.',
    );
  });
});

describe("Schema gegen Migrationen (migrate:check)", () => {
  it("vergleicht die Migrationen mit schema.prisma und meldet Unterschiede mit Exit 2", () => {
    const pkg = JSON.parse(lesen("packages/db/package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["migrate:check"]).toBe(
      "prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code",
    );
  });

  it("laeuft in der CI direkt nach den Migrationen, mit eigener Schattendatenbank", () => {
    type Schritt = { name?: string; run?: string; env?: Record<string, string> };
    const wf = parse(lesen(".github/workflows/ci.yml")) as {
      jobs: Record<string, { steps: Schritt[]; env?: Record<string, string> }>;
    };
    const schritte = wf.jobs.e2e.steps;
    const nach = schritte.findIndex((s) => s.name === "Run migrations");
    expect(nach).toBeGreaterThanOrEqual(0);
    const pruefung = schritte[nach + 1];
    expect(pruefung.name).toBe("Schema gegen Migrationen (prisma migrate diff)");
    expect(pruefung.run).toContain("pnpm --filter @dokunc/db migrate:check");
    const schatten = new URL(pruefung.env?.SHADOW_DATABASE_URL ?? "");
    const app = new URL(wf.jobs.e2e.env?.DATABASE_URL ?? "");
    expect(schatten.pathname).not.toBe(app.pathname);
    // Die Schattendatenbank legt der Schritt selbst an.
    expect(pruefung.run).toContain(`CREATE DATABASE ${schatten.pathname.slice(1)}`);
  });
});

describe("prisma.config.ts: Schattendatenbank", () => {
  const APP = "postgresql://dokunc:dokunc@localhost:5432/dokunc?schema=public";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function laden(shadow: string | undefined) {
    vi.stubEnv("DATABASE_URL", APP);
    vi.stubEnv("SHADOW_DATABASE_URL", shadow);
    vi.resetModules();
    const modul = await import("../../../packages/db/prisma.config");
    return modul.default as { datasource?: { shadowDatabaseUrl?: string } };
  }

  it("setzt ohne SHADOW_DATABASE_URL keine Schattendatenbank (migrate deploy und dev wie bisher)", async () => {
    expect((await laden(undefined)).datasource?.shadowDatabaseUrl).toBeUndefined();
    expect((await laden("")).datasource?.shadowDatabaseUrl).toBeUndefined();
  });

  it("nimmt eine eigene Datenbank", async () => {
    const url = "postgresql://dokunc:dokunc@localhost:5432/dokunc_schatten";
    expect((await laden(url)).datasource?.shadowDatabaseUrl).toBe(url);
  });

  it.each([
    ["dieselbe URL", APP],
    ["andere Anmeldung, andere Parameter", "postgresql://root:x@LOCALHOST:5432/dokunc"],
    ["Port nicht angegeben", "postgresql://dokunc:dokunc@localhost/dokunc"],
  ])("weist die Datenbank der App ab: %s", async (_fall, url) => {
    await expect(laden(url)).rejects.toThrow(
      "SHADOW_DATABASE_URL zeigt auf dieselbe Datenbank wie DATABASE_URL",
    );
  });
});
