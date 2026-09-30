import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Aufbau von CHANGELOG.md (Keep a Changelog, englisch).
 *
 * Geprueft wird nur die Form, auf die sich Beitragende und spaeter die
 * Release-Werkzeuge verlassen: Kopf, "Unreleased" zuerst, erlaubte
 * Abschnitte in fester Reihenfolge ohne Dublette, Eintraege als
 * Listenpunkte, Upgrade notes mit fettem Stichwort, Versionskoepfe mit
 * Datum. Parallele Zweige haengen ihre Eintraege per merge=union an
 * (.gitattributes); Ueberschriften legt deshalb niemand ausser dieser
 * Vorlage an.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const ABSCHNITTE = [
  "Upgrade notes",
  "Security",
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
] as const;

const PFLICHT_UNRELEASED = ["Upgrade notes", "Security"];

type Version = { kopf: string; zeile: number; abschnitte: Abschnitt[] };
/** `nachLeerzeile`: die Zeile davor ist leer (oder die Ueberschrift selbst). */
type Abschnitt = {
  name: string;
  zeile: number;
  inhalt: { text: string; zeile: number; nachLeerzeile: boolean }[];
};

/** Zerlegt den Text in Versionen und ihre Abschnitte. */
export function zerlegen(text: string): { kopf: string[]; versionen: Version[] } {
  const zeilen = text.split("\n");
  const kopf: string[] = [];
  const versionen: Version[] = [];
  let version: Version | undefined;
  let abschnitt: Abschnitt | undefined;
  let leerDavor = false;
  zeilen.forEach((z, i) => {
    const nr = i + 1;
    if (z.startsWith("## ")) {
      version = { kopf: z.slice(3), zeile: nr, abschnitte: [] };
      versionen.push(version);
      abschnitt = undefined;
    } else if (z.startsWith("### ")) {
      if (!version) throw new Error(`Zeile ${nr}: Abschnitt vor der ersten Version`);
      abschnitt = { name: z.slice(4), zeile: nr, inhalt: [] };
      version.abschnitte.push(abschnitt);
    } else if (!version) {
      kopf.push(z);
    } else if (z.trim() !== "") {
      if (!abschnitt) throw new Error(`Zeile ${nr}: Text ausserhalb eines Abschnitts`);
      abschnitt.inhalt.push({ text: z, zeile: nr, nachLeerzeile: leerDavor });
    }
    leerDavor = z.trim() === "";
  });
  return { kopf, versionen };
}

/** Liefert alle Verstoesse gegen die Regeln, leer bei gueltigem Text. */
export function pruefen(text: string): string[] {
  const fehler: string[] = [];
  let teile: ReturnType<typeof zerlegen>;
  try {
    teile = zerlegen(text);
  } catch (e) {
    return [(e as Error).message];
  }
  if (teile.kopf[0] !== "# Changelog") fehler.push("erste Zeile ist nicht '# Changelog'");
  const [erste, ...rest] = teile.versionen;
  if (!erste || erste.kopf !== "[Unreleased]") {
    fehler.push("erste Version ist nicht '## [Unreleased]'");
  } else {
    const namen = erste.abschnitte.map((a) => a.name);
    for (const p of PFLICHT_UNRELEASED) {
      if (!namen.includes(p)) fehler.push(`'### ${p}' fehlt unter Unreleased`);
    }
  }
  for (const v of rest) {
    if (!/^\[\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\] - \d{4}-\d{2}-\d{2}$/.test(v.kopf)) {
      fehler.push(`Zeile ${v.zeile}: Versionskopf '${v.kopf}' hat nicht die Form '[x.y.z] - JJJJ-MM-TT'`);
    }
  }
  for (const v of teile.versionen) {
    let vorher = -1;
    const gesehen = new Set<string>();
    for (const a of v.abschnitte) {
      const pos = (ABSCHNITTE as readonly string[]).indexOf(a.name);
      if (pos < 0) {
        fehler.push(`Zeile ${a.zeile}: Abschnitt '${a.name}' ist nicht erlaubt`);
        continue;
      }
      if (gesehen.has(a.name)) fehler.push(`Zeile ${a.zeile}: Abschnitt '${a.name}' doppelt`);
      if (pos < vorher) fehler.push(`Zeile ${a.zeile}: Abschnitt '${a.name}' steht ausser der Reihe`);
      gesehen.add(a.name);
      vorher = Math.max(vorher, pos);
      a.inhalt.forEach((z, n) => {
        if (!z.text.startsWith("- ") && !z.text.startsWith("  ")) {
          fehler.push(`Zeile ${z.zeile}: Eintrag beginnt weder mit '- ' noch mit zwei Leerzeichen`);
        }
        if (a.name === "Upgrade notes" && z.text.startsWith("- ") && !/^- \*\*[^*]+:\*\* /.test(z.text)) {
          fehler.push(`Zeile ${z.zeile}: Upgrade note beginnt nicht mit einem fetten Stichwort samt Doppelpunkt`);
        }
        // Upgrade notes stehen durch Leerzeilen getrennt. Haengen zwei
        // Zweige ihre Notes an dieselbe Stelle an, schreibt die
        // Union-Zusammenfuehrung (.gitattributes) gleiche Zeilen an der
        // Naht nur einmal, und die Leerzeile zwischen den Bloecken faellt
        // weg: die zweite Note klebt dann an der ersten.
        if (a.name === "Upgrade notes" && n > 0 && z.text.startsWith("- ") && !z.nachLeerzeile) {
          fehler.push(`Zeile ${z.zeile}: Upgrade note steht nicht nach einer Leerzeile`);
        }
      });
    }
  }
  return fehler;
}

describe("CHANGELOG.md", () => {
  it("haelt die Regeln ein", () => {
    expect(pruefen(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"))).toEqual([]);
  });

  it("wird von .gitattributes per merge=union zusammengefuehrt", () => {
    const zeilen = readFileSync(join(ROOT, ".gitattributes"), "utf8").split("\n");
    expect(zeilen).toContain("CHANGELOG.md merge=union");
  });
});

describe("pruefen", () => {
  const gut = [
    "# Changelog",
    "",
    "Kopftext.",
    "",
    "## [Unreleased]",
    "",
    "### Upgrade notes",
    "",
    "- **Mail sender:** Set MAIL_FROM. Nothing else to do.",
    "",
    "- **Log rotation:** Docker keeps five files",
    "  per container. Nothing to do.",
    "",
    "### Security",
    "",
    "### Fixed",
    "",
    "- A fix",
    "  that spans two lines.",
    "",
    "## [0.9.0] - 2026-11-02",
    "",
    "### Added",
    "",
    "- Something",
  ].join("\n");

  it("nimmt einen gueltigen Text an", () => {
    expect(pruefen(gut)).toEqual([]);
  });

  it.each([
    ["falscher Kopf", gut.replace("# Changelog", "# Changes"), "erste Zeile"],
    ["Unreleased umbenannt", gut.replace("## [Unreleased]", "## Unreleased"), "erste Version"],
    ["Upgrade notes fehlt", gut.replace(/### Upgrade notes\n[\s\S]*?(?=### Security)/, ""), "'### Upgrade notes' fehlt"],
    ["fremder Abschnitt", gut.replace("### Fixed", "### Features"), "nicht erlaubt"],
    ["doppelter Abschnitt", gut.replace("### Fixed", "### Security"), "doppelt"],
    ["falsche Reihenfolge", gut.replace("### Security", "### Changed").replace("### Fixed", "### Security"), "ausser der Reihe"],
    ["Fliesstext", gut.replace("- A fix", "A fix"), "weder mit '- '"],
    ["Upgrade note ohne Stichwort", gut.replace("- **Mail sender:** Set", "- Set"), "fetten Stichwort"],
    ["Version ohne Klammern", gut.replace("## [0.9.0] - 2026-11-02", "## 0.9.0"), "Versionskopf"],
    // So sieht die Naht zweier Zweige nach einer Union-Zusammenfuehrung
    // aus: die gemeinsame Leerzeile steht nur noch einmal im Text.
    [
      "Upgrade note ohne Leerzeile davor",
      gut.replace("Nothing else to do.\n\n- **Log rotation:**", "Nothing else to do.\n- **Log rotation:**"),
      "Zeile 10: Upgrade note steht nicht nach einer Leerzeile",
    ],
  ])("meldet: %s", (_name, text, erwartet) => {
    expect(pruefen(text).join("\n")).toContain(erwartet);
  });
});
