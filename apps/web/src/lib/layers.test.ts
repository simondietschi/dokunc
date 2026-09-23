import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Die Stapelebenen stehen an EINER Stelle: als Theme-Variablen
 * `--z-index-*` in app/globals.css (dort auch die Begruendung der
 * Reihenfolge). Diese Tests halten fest, was die Skala verspricht, und
 * schlagen an, wenn jemand an ihr vorbei wieder mit nackten Zahlen in
 * die Ebenen ueber der Seite greift.
 */

const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "app/globals.css"), "utf8");

/** Die benannten Ebenen aus dem @theme-Block. */
function ebenen(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of css.matchAll(/--z-index-([a-z-]+):\s*(\d+)\s*;/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

function quelldateien(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const pfad = join(dir, name);
    if (statSync(pfad).isDirectory()) out.push(...quelldateien(pfad));
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(pfad);
    }
  }
  return out;
}

/** Jede als Zahl geschriebene Stapelhoehe: Tailwind, CSS, Inline-Stil. */
const ROHE_Z = [
  /(?<![\w-])z-(\d+)(?![\w-])/g,
  /(?<![\w-])z-\[(\d+)\]/g,
  /z-index:\s*(\d+)/g,
  /zIndex\s*[:=]\s*["']?(\d+)/g,
];

describe("Stapelebenen", () => {
  const z = ebenen();

  it("die Skala hat Modal, Toast und Sprunglink in dieser Reihenfolge", () => {
    expect(Object.keys(z).sort()).toEqual(["modal", "skip-link", "toast"]);
    // Toast ueber jedem Modal, der Sprunglink ueber allem.
    expect(z.modal).toBeLessThan(z.toast);
    expect(z.toast).toBeLessThan(z["skip-link"]);
  });

  it("nichts auf der Seite liegt mit einer nackten Zahl ueber einem Modal", () => {
    // Menues, Kopfzeilen, die Vorschlagsliste im Editor duerfen eigene
    // Zahlen tragen, aber alle unter der Modal-Ebene. Was hoeher will,
    // nimmt eine benannte Ebene — frueher standen hier z-[90] und
    // z-[100] an fuenf Stellen, und wer oben lag, hing vom Zufall der
    // DOM-Reihenfolge ab.
    expect(z.modal, "Modal-Ebene fehlt in globals.css").toBeTypeOf("number");
    const zuHoch: string[] = [];
    for (const datei of quelldateien(SRC)) {
      const text = readFileSync(datei, "utf8");
      text.split("\n").forEach((zeile, i) => {
        for (const muster of ROHE_Z) {
          for (const m of zeile.matchAll(muster)) {
            if (Number(m[1]) >= z.modal) {
              zuHoch.push(`${relative(SRC, datei)}:${i + 1}: ${m[0]}`);
            }
          }
        }
      });
    }
    expect(zuHoch).toEqual([]);
  });

  it("jedes modale Fenster liegt auf der Modal-Ebene und haengt im Portal", () => {
    // Die Modal-Ebene ordnet in Oeffnungsreihenfolge, weil jedes Fenster
    // beim Oeffnen ans Ende von <body> gehaengt wird. Ein Modal an einem
    // festen Platz im Layout (so stand die Befehlspalette) laege unter
    // jedem spaeter geoeffneten, auch wenn es die Tasten bekommt.
    const modale = quelldateien(SRC).filter(
      (datei) =>
        datei.endsWith(".tsx") &&
        readFileSync(datei, "utf8").includes('aria-modal="true"'),
    );
    const namen = modale.map((d) => relative(SRC, d)).sort();
    // Die bekannten Fenster muessen dabei sein, sonst prueft der Test
    // ins Leere.
    expect(namen).toEqual(
      expect.arrayContaining([
        "components/CommandPalette.tsx",
        "components/space/MovePageDialog.tsx",
        "components/space/TemplatePicker.tsx",
        "components/ui/Dialog.tsx",
        "components/ui/FullscreenDialog.tsx",
      ]),
    );
    for (const datei of modale) {
      const text = readFileSync(datei, "utf8");
      expect(text, relative(SRC, datei)).toMatch(/\bz-modal\b/);
      expect(text, relative(SRC, datei)).toMatch(/createPortal\(/);
    }
  });

  it("der Toast liegt auf seiner eigenen Ebene", () => {
    const toast = readFileSync(join(SRC, "components/ui/Toast.tsx"), "utf8");
    expect(toast).toMatch(/\bz-toast\b/);
  });
});
