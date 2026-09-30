import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@dokunc/db";
import {
  ERWARTUNG,
  type Akteur,
  type Ausgang,
  type Szenario,
  type Zelle,
} from "../rechtematrix/erwartung";

/**
 * Tabellengetriebener Lauf der Rechtematrix.
 *
 * Für jeden geprüften Eintrag aus test/rechtematrix/erwartung.ts, jedes
 * Szenario und jeden genannten Akteur ein Fall: Seiten vorbereiten, die
 * echte Action als dieser Akteur aufrufen, an der Datenbank feststellen,
 * ob sie gewirkt hat, und den Ausgang mit der Erwartung vergleichen.
 * Nach "erlaubt" prüft die benannte Invariante, ob der Schutz hält.
 *
 * Ersetzt sind nur Anmeldung (aus der Welt, mit echter Sitzungszeile),
 * Anfrage-Header, Cache und die Umleitung. Datenbank, Rollenprüfung,
 * Seitenwächter und collab-sync laufen echt.
 *
 * Lückenzellen erwarten ausdrücklich den heutigen Ausgang. Liegt die
 * Lücke in der Wirkung (heute wie erwartet "erlaubt"), muss die
 * Invariante heute scheitern. Schliesst eine Änderung die Lücke, wird
 * der Fall rot, und der Marker in erwartung.ts fällt weg.
 */

vi.mock("next/navigation", async (importOriginal) => {
  const { Umleitung } = await import("./rechtematrix-welt");
  return {
    ...(await importOriginal<typeof import("next/navigation")>()),
    redirect: vi.fn((url: string) => {
      throw new Umleitung(url);
    }),
  };
});
vi.mock("@/lib/current-user", async (importOriginal) => {
  const { Umleitung, currentUserAttrappe } = await import("./rechtematrix-welt");
  return {
    ...(await importOriginal<typeof import("@/lib/current-user")>()),
    ...currentUserAttrappe((url) => {
      throw new Umleitung(url);
    }),
  };
});
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  createSession: vi.fn(),
  destroySession: vi.fn(),
  getSessionClaims: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", async () =>
  (await import("./rechtematrix-welt")).headersAttrappe(),
);

const { baueWelt, raeumeWelt } = await import("./rechtematrix-welt");
const { INVARIANTEN, TREIBER } = await import("./rechtematrix-treiber");
type Welt = Awaited<ReturnType<typeof baueWelt>>;
type Ergebnis = Awaited<ReturnType<(typeof TREIBER)[string][string]["aufrufen"]>>;

let w: Welt;
beforeAll(async () => {
  w = await baueWelt();
}, 60_000);
afterEach(async () => {
  await w.aufraeumen();
});
afterAll(async () => {
  await raeumeWelt(w);
});

/** Ein Absturz ist keine Ablehnung: diese Fehler machen den Fall rot. */
function istAbsturz(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError ||
    e instanceof Prisma.PrismaClientValidationError ||
    e instanceof TypeError
  );
}

function beschreibe(e: Ergebnis): string {
  switch (e.art) {
    case "fertig":
      return "Aufruf endete normal";
    case "umleitung":
      return `Umleitung nach ${e.url}`;
    case "bestaetigung":
      return `Rückfrage mit Token ${e.token}`;
    case "fehler":
      return `Fehler: ${e.fehler instanceof Error ? e.fehler.message : String(e.fehler)}`;
  }
}

async function fall(
  schluessel: string,
  name: string,
  szenario: Szenario,
  akteur: Akteur,
  zelle: Zelle,
): Promise<void> {
  const treiber = TREIBER[schluessel]?.[name];
  expect(treiber, "Treiber fehlt").toBeDefined();
  const fx = await treiber.vorbereiten(w);
  expect(await treiber.wirkung(w, fx), "Wirkung schon vor dem Aufruf").toBe(false);

  const ergebnis = await treiber.aufrufen(w, fx, akteur);
  if (ergebnis.art === "fehler" && istAbsturz(ergebnis.fehler)) {
    throw ergebnis.fehler;
  }
  const ausgang: Ausgang = (await treiber.wirkung(w, fx))
    ? "erlaubt"
    : ergebnis.art === "bestaetigung"
      ? "bestaetigung"
      : "abgelehnt";
  const invariante = szenario.invariante
    ? INVARIANTEN[szenario.invariante]
    : undefined;

  if (typeof zelle === "string") {
    expect(ausgang, beschreibe(ergebnis)).toBe(zelle);
    if (zelle === "erlaubt" && invariante) await invariante(w, fx);
    return;
  }

  expect(
    ausgang,
    `Lücke ${zelle.luecke}: heute "${zelle.heute}", erwartet "${zelle.erwartet}" ` +
      `(${beschreibe(ergebnis)}). Geschlossen? Dann den Marker in erwartung.ts entfernen.`,
  ).toBe(zelle.heute);
  if (zelle.heute === "erlaubt" && zelle.erwartet === "erlaubt" && invariante) {
    const haelt = await invariante(w, fx).then(
      () => true,
      () => false,
    );
    expect(
      haelt,
      `Lücke ${zelle.luecke}: die Invariante ${szenario.invariante} hält schon. ` +
        `Den Marker in erwartung.ts entfernen.`,
    ).toBe(false);
  }
}

describe("Rechtematrix", () => {
  const geprueft = Object.entries(ERWARTUNG).flatMap(([k, e]) =>
    e.stand === "geprueft" ? [[k, e] as const] : [],
  );

  it("jeder Treiber gehört zu einem geprüften Eintrag", () => {
    const schluessel = new Set(geprueft.map(([k]) => k));
    expect(Object.keys(TREIBER).filter((k) => !schluessel.has(k))).toEqual([]);
  });

  for (const [schluessel, eintrag] of geprueft) {
    describe(schluessel, () => {
      it("hat einen Treiber", () => {
        expect(TREIBER[schluessel]).toBeDefined();
      });
      it("Treiber-Szenarien = Erwartungs-Szenarien", () => {
        expect(Object.keys(TREIBER[schluessel] ?? {}).sort()).toEqual(
          Object.keys(eintrag.szenarien).sort(),
        );
      });
      for (const [name, szenario] of Object.entries(eintrag.szenarien)) {
        for (const [akteur, zelle] of Object.entries(szenario.akteure)) {
          it(`${name} / ${akteur}`, () =>
            fall(schluessel, name, szenario, akteur as Akteur, zelle!));
        }
      }
    });
  }
});
