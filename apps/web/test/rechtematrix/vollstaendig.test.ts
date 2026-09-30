import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERWARTUNG, OFFEN_BESTAND, type Eintrag } from "./erwartung";
import {
  actionsAusQuelltext,
  inventar,
  istServerActionDatei,
  pruefeInlineDirektiven,
  routenAusQuelltext,
} from "./inventar";
import { pruefeErwartung, routenMuster, type PruefEingabe } from "./regeln";

/**
 * Meta-Test der Rechtematrix, ohne Datenbank.
 *
 * Jede Server Action und jede Route braucht einen Eintrag in
 * erwartung.ts. Wer eine neue Action anlegt, sieht hier, dass sie in
 * die Matrix gehört; wer sie in eine Form bringt, die das Inventar nicht
 * lesen kann, ebenso. Die Regeln selbst stehen in regeln.ts und werden
 * unten mit ausgedachten Einträgen einzeln zum Anschlagen gebracht.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

function dateiText(pfad: string): string | null {
  const voll = `${REPO}${pfad}`;
  return existsSync(voll) ? readFileSync(voll, "utf8") : null;
}

describe("Rechtematrix: Vollständigkeit", () => {
  it("jede Action und jede Route hat einen Eintrag, und alle Regeln halten", () => {
    const befunde = pruefeErwartung({
      inventar: inventar(SRC),
      erwartung: ERWARTUNG,
      offenBestand: OFFEN_BESTAND,
      dateiText,
    });
    expect(befunde).toEqual([]);
  });

  it("das Inventar findet die bekannten Endpunkte", () => {
    const alle = inventar(SRC);
    expect(alle).toContain("action:app/s/[slug]/actions.ts#purgePageAction");
    // Derselbe Name in zwei Dateien: zwei Schlüssel.
    expect(alle).toContain("action:app/admin/actions.ts#deleteSpaceAction");
    expect(alle).toContain("action:app/s/[slug]/settings/actions.ts#deleteSpaceAction");
    expect(alle).toContain("route:app/api/pages/[id]/export/route.ts#GET");
    expect(alle.filter((k) => k.startsWith("route:")).length).toBeGreaterThan(0);
  });
});

describe("Rechtematrix: Inventar-Regeln", () => {
  it("liest Actions aus einer \"use server\"-Datei, Typen zählen nicht", () => {
    const text = [
      "// Kopfkommentar",
      "/* Block",
      "   über zwei Zeilen */",
      '"use server";',
      "",
      "export type Zustand = { ok: boolean };",
      "export interface Form { a: string }",
      "export async function speichernAction(form: FormData) {}",
      "export function sofortAction<T>(x: T) {}",
    ].join("\n");
    expect(istServerActionDatei(text)).toBe(true);
    expect(actionsAusQuelltext("app/x/actions.ts", text)).toEqual([
      "action:app/x/actions.ts#speichernAction",
      "action:app/x/actions.ts#sofortAction",
    ]);
  });

  it.each([
    "export const loeschenAction = async () => {};",
    "export default async function Standard() {}",
    "export { heimlichAction };",
    'export * from "./andere";',
    "export let wert = 1;",
  ])("wirft bei der Exportform %s", (zeile) => {
    const text = `"use server";\n\n${zeile}\n`;
    expect(() => actionsAusQuelltext("app/x/actions.ts", text)).toThrow(
      /app\/x\/actions\.ts:3: Exportform/,
    );
  });

  it("wirft bei einer Direktive im Funktionskörper", () => {
    const text = [
      'import { a } from "b";',
      "export function Knopf() {",
      "  async function speichern() {",
      '    "use server";',
      "  }",
      "}",
    ].join("\n");
    expect(istServerActionDatei(text)).toBe(false);
    expect(() => pruefeInlineDirektiven("app/x/Knopf.tsx", text)).toThrow(
      "app/x/Knopf.tsx:4: Inline-Server-Action",
    );
    // Die Direktive als erste Anweisung ist keine Inline-Direktive.
    expect(() =>
      pruefeInlineDirektiven("app/x/actions.ts", `// c\n'use server'\nexport async function a() {}`),
    ).not.toThrow();
  });

  it("liest Handler einer route.ts und übergeht Konfigurationsexporte", () => {
    const text = [
      'export const runtime = "nodejs";',
      "export const maxDuration = 60;",
      "export type Antwort = { ok: boolean };",
      "export async function GET(req: Request) {}",
      "export function POST() {}",
      "export const DELETE = async () => {};",
    ].join("\n");
    expect(routenAusQuelltext("app/api/x/route.ts", text)).toEqual([
      "route:app/api/x/route.ts#GET",
      "route:app/api/x/route.ts#POST",
      "route:app/api/x/route.ts#DELETE",
    ]);
  });

  it.each(['export { GET } from "../andere/route";', "export default handler;"])(
    "wirft in einer route.ts bei %s",
    (zeile) => {
      expect(() => routenAusQuelltext("app/api/x/route.ts", zeile)).toThrow(
        /Wieder- oder Standardexport/,
      );
    },
  );
});

describe("Rechtematrix: Inventar ohne tote Winkel", () => {
  /** Inventar eines ausgedachten src-Verzeichnisses. */
  function inventarVon(dateien: Record<string, string>): string[] {
    const dir = mkdtempSync(join(tmpdir(), "rechtematrix-"));
    try {
      for (const [pfad, text] of Object.entries(dateien)) {
        mkdirSync(dirname(join(dir, pfad)), { recursive: true });
        writeFileSync(join(dir, pfad), text);
      }
      return inventar(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const ACTION = "\nexport async function heimlichAction(form: FormData) {}\n";

  it.each([
    '"use server"; // Probe',
    "'use server' /* Probe */;",
    '/* Kopf */ "use server";',
    '/**\n * Kopf\n */ "use server"',
    '"use strict";\n"use server";',
  ])("erkennt die Direktive in %j", (kopf) => {
    expect(inventarVon({ "app/probe/actions.ts": `${kopf}\n${ACTION}` })).toEqual([
      "action:app/probe/actions.ts#heimlichAction",
    ]);
  });

  it("wirft bei einer zweiten Exportform in derselben Zeile", () => {
    const text = `"use server";\nexport async function aAction() {} export const bAction = async () => {};\n`;
    expect(() => inventarVon({ "app/x/actions.ts": text })).toThrow(
      /app\/x\/actions\.ts:2: Exportform/,
    );
  });

  it("wirft bei einer Direktive mit Kommentar im Funktionskörper", () => {
    const text = [
      "export function Knopf() {",
      "  async function speichern() {",
      '    "use server"; // inline',
      "  }",
      "}",
    ].join("\n");
    expect(() => inventarVon({ "app/x/Knopf.tsx": text })).toThrow(
      "app/x/Knopf.tsx:3: Inline-Server-Action",
    );
  });

  it("wirft bei einer Direktive nach den Importen", () => {
    const text = `import { a } from "b";\n"use server"; // zu spät\n${ACTION}`;
    expect(() => inventarVon({ "app/x/actions.ts": text })).toThrow(/app\/x\/actions\.ts:2: /);
  });

  it.each([
    'export const { POST } = { POST: async () => new Response("x") };',
    'export let PUT = async () => new Response("x");',
    'export var GET = async () => new Response("x");',
    "export const hilfe = 1;",
    "export function hilfe() {}",
    "export class Handler {}",
    'export async function GET() { return new Response("x"); } export const { POST } = h;',
  ])("wirft in einer route.ts bei %s", (zeile) => {
    expect(() => inventarVon({ "app/api/x/route.ts": `${zeile}\n` })).toThrow(
      /app\/api\/x\/route\.ts:1: /,
    );
  });

  it("liest route.tsx wie route.ts", () => {
    const text = 'export async function GET() { return new Response("x"); }\n';
    expect(inventarVon({ "app/api/bild/route.tsx": text })).toEqual([
      "route:app/api/bild/route.tsx#GET",
    ]);
    expect(routenMuster("route:app/api/bild/route.tsx#GET").test('"/api/bild"')).toBe(true);
  });

  it.each(["app/s/[slug]/opengraph-image.tsx", "app/sitemap.ts", "pages/api/x.ts"])(
    "wirft bei der ungelesenen Endpunktdatei %s",
    (pfad) => {
      expect(() =>
        inventarVon({ [pfad]: 'export default function h() { return new Response("x"); }\n' }),
      ).toThrow(/Endpunkt, den das Inventar nicht liest/);
    },
  );
});

describe("Rechtematrix: Regeln der Erwartungsdatei", () => {
  const A = "action:app/a.ts#aAction";
  const B = "action:app/a.ts#bAction";
  const R = "route:app/(auth)/abmelden/route.ts#POST";
  const geprueft: Eintrag = {
    stand: "geprueft",
    szenarien: {
      fall: { akteure: { abgemeldet: "abgelehnt", OWNER: "erlaubt" } },
    },
  };
  function pruefe(o: Partial<PruefEingabe>): string[] {
    return pruefeErwartung({
      inventar: [A],
      erwartung: { [A]: geprueft },
      offenBestand: [],
      dateiText: () => null,
      ...o,
    });
  }

  it("ein gültiger Stand ergibt keine Befunde", () => {
    expect(pruefe({})).toEqual([]);
  });

  it("meldet eine neue Action ohne Eintrag und einen veralteten Eintrag", () => {
    expect(pruefe({ inventar: [A, B] })).toEqual([
      `${B}: neue Action/Route ohne Eintrag in test/rechtematrix/erwartung.ts`,
    ]);
    expect(pruefe({ inventar: [] })[0]).toMatch(/veralteter Eintrag/);
  });

  it("verlangt sortierte Schlüssel", () => {
    const befunde = pruefe({
      inventar: [A, B],
      erwartung: { [B]: geprueft, [A]: geprueft },
    });
    expect(befunde.join("\n")).toMatch(/nicht nach Schlüssel sortiert/);
  });

  it("offen nur mit Eintrag in OFFEN_BESTAND, und umgekehrt", () => {
    const offen: Eintrag = { stand: "offen", grund: "noch ohne Fälle" };
    expect(pruefe({ erwartung: { [A]: offen } })[0]).toMatch(
      /darf nicht offen sein/,
    );
    expect(pruefe({ erwartung: { [A]: offen }, offenBestand: [A] })).toEqual([]);
    expect(pruefe({ offenBestand: [A] })[0]).toMatch(/aus OFFEN_BESTAND streichen/);
  });

  it("ein Szenario nennt abgemeldet und lässt jemanden etwas tun", () => {
    const ohneAbgemeldet: Eintrag = {
      stand: "geprueft",
      szenarien: { fall: { akteure: { OWNER: "erlaubt" } } },
    };
    expect(pruefe({ erwartung: { [A]: ohneAbgemeldet } })[0]).toMatch(
      /nennt den Akteur "abgemeldet" nicht/,
    );
    const niemand: Eintrag = {
      stand: "geprueft",
      szenarien: {
        fall: { akteure: { abgemeldet: "abgelehnt", OWNER: "abgelehnt" } },
      },
    };
    expect(pruefe({ erwartung: { [A]: niemand } })[0]).toMatch(
      /kein Akteur mit "erlaubt" oder "bestaetigung"/,
    );
    // Eine Rückfrage zählt wie "erlaubt".
    const rueckfrage: Eintrag = {
      stand: "geprueft",
      szenarien: {
        fall: { akteure: { abgemeldet: "abgelehnt", OWNER: "bestaetigung" } },
      },
    };
    expect(pruefe({ erwartung: { [A]: rueckfrage } })).toEqual([]);
  });

  it("eine Lückenzelle weicht heute ab, ausser eine Invariante trägt die Lücke", () => {
    const zelle = (heute: "erlaubt" | "abgelehnt", invariante?: "kopieGeschuetzt") =>
      ({
        stand: "geprueft",
        szenarien: {
          fall: {
            ...(invariante ? { invariante } : {}),
            akteure: {
              abgemeldet: "abgelehnt",
              OWNER: { erwartet: "erlaubt", heute, luecke: "schutz-kopie" },
            },
          },
        },
      }) satisfies Eintrag;
    expect(pruefe({ erwartung: { [A]: zelle("abgelehnt") } })).toEqual([]);
    expect(pruefe({ erwartung: { [A]: zelle("erlaubt") } })[0]).toMatch(
      /Lückenzelle mit heute = erwartet/,
    );
    expect(
      pruefe({ erwartung: { [A]: zelle("erlaubt", "kopieGeschuetzt") } }),
    ).toEqual([]);
  });

  it("extern: Dateien existieren, eine davon Integration oder E2E, jede nennt den Endpunkt", () => {
    const extern = (tests: string[]): Eintrag => ({
      stand: "extern",
      tests,
      grund: "eigene Fälle",
    });
    const dateien: Record<string, string> = {
      "apps/web/test/integration/a.test.ts": "await aAction(form)",
      "apps/web/src/lib/a.test.ts": "aAction",
      "apps/web/src/lib/b.test.ts": "anderes",
      "e2e/abmelden.spec.ts": 'await page.request.post("/abmelden")',
    };
    const lies = (p: string) => dateien[p] ?? null;
    expect(
      pruefe({
        erwartung: { [A]: extern(["apps/web/test/integration/a.test.ts"]) },
        dateiText: lies,
      }),
    ).toEqual([]);
    expect(
      pruefe({ erwartung: { [A]: extern(["apps/web/src/lib/a.test.ts"]) }, dateiText: lies }),
    ).toEqual([expect.stringMatching(/mindestens einen Integrations- oder E2E-Test/)]);
    expect(
      pruefe({ erwartung: { [A]: extern(["e2e/fehlt.spec.ts"]) }, dateiText: lies })[0],
    ).toMatch(/gibt es nicht/);
    expect(
      pruefe({
        erwartung: {
          [A]: extern(["apps/web/test/integration/a.test.ts", "apps/web/src/lib/b.test.ts"]),
        },
        dateiText: lies,
      }),
    ).toEqual([expect.stringMatching(/b\.test\.ts nennt "aAction" nicht/)]);
    // Routen: der Pfad ohne Routengruppe.
    expect(
      pruefe({
        inventar: [R],
        erwartung: { [R]: extern(["e2e/abmelden.spec.ts"]) },
        dateiText: lies,
      }),
    ).toEqual([]);
  });

  it("oeffentlich: nur Routen, mit Begründung", () => {
    const kurz: Eintrag = { stand: "oeffentlich", grund: "weil" };
    const lang: Eintrag = {
      stand: "oeffentlich",
      grund: "Abmeldeseite, erreichbar ohne gültige Sitzung",
    };
    expect(pruefe({ erwartung: { [A]: lang } })[0]).toMatch(/nur für Routen/);
    expect(pruefe({ inventar: [R], erwartung: { [R]: kurz } })[0]).toMatch(
      /zu kurz/,
    );
    expect(pruefe({ inventar: [R], erwartung: { [R]: lang } })).toEqual([]);
  });

  it("der Routenpfad erlaubt beliebige Werte in dynamischen Segmenten", () => {
    const muster = routenMuster("route:app/api/pages/[id]/export/route.ts#GET");
    expect(muster.test("fetch(`/api/pages/${id}/export?format=md`)")).toBe(true);
    expect(muster.test('"/api/pages/abc123/export"')).toBe(true);
    expect(muster.test('"/api/pages/abc123/exporter"')).toBe(false);
    expect(muster.test('"/api/pages"')).toBe(false);
  });
});
