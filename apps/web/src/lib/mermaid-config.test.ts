// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import mermaid, { type MermaidConfig } from "mermaid";
import { mermaidConfig } from "./mermaid-config";

/**
 * Die Typen, deren Renderer in mermaid 12.0.0 das Layout aus der
 * Konfiguration waehlen (getRegisteredLayoutAlgorithm mit `layout` aus
 * getConfig): Fluss-, Zustands-, Klassen-, ER-, Requirement-, Use-Case-
 * und Agentflow-Diagramm. Mindmap faellt dort auf cose-bilkent zurueck und
 * steht bewusst nicht hier (siehe den Test unten). Ob die Werte im Browser
 * ankommen, prueft e2e/mermaid.spec.ts: ohne `layout: elk` im Diagramm
 * laedt keiner dieser Typen den ELK-Chunk.
 */
const LAYOUT_TYPEN = [
  "flowchart",
  "state",
  "class",
  "er",
  "requirement",
  "usecase",
  "agentflow",
] as const;

type LayoutTyp = (typeof LAYOUT_TYPEN)[number];

/**
 * Das Layout, das mermaid fuer einen Typ aufloest, wenn weder Front Matter
 * noch Direktive etwas sagen: erst initialize(), dann die Vorgabe des
 * Typs, dann die globale Vorgabe; in jeder Ebene schlaegt der Abschnitt
 * des Typs den globalen Wert (resolveAppearance, mermaid #8193).
 */
function layoutFuer(typ: LayoutTyp, init: MermaidConfig): unknown {
  const vorgabe = mermaid.mermaidAPI.defaultConfig as MermaidConfig;
  for (const ebene of [init, vorgabe]) {
    const wert = ebene[typ]?.layout ?? ebene.layout;
    if (wert !== undefined) return wert;
  }
  return undefined;
}

describe("mermaidConfig", () => {
  it("rendert streng und nur auf Aufruf, hell wie dunkel", () => {
    for (const dunkel of [false, true]) {
      const c = mermaidConfig(dunkel);
      expect(c.securityLevel).toBe("strict");
      expect(c.startOnLoad).toBe(false);
    }
  });

  it("folgt dem Hell/Dunkel-Modus", () => {
    expect(mermaidConfig(false).theme).toBe("default");
    expect(mermaidConfig(true).theme).toBe("dark");
  });

  it("legt jeden Typ, der ein Layout waehlt, von mermaids ELK auf dagre", () => {
    for (const typ of LAYOUT_TYPEN) {
      // Ohne eigene Angabe naehme mermaid 12 fuer jeden dieser Typen ELK
      // und luede dafuer den ELK-Chunk. Faellt das weg, ist der Eintrag in
      // mermaidConfig ueberfluessig geworden.
      expect(layoutFuer(typ, {}), `${typ} ohne dokunc`).toBe("elk");
      for (const dunkel of [false, true]) {
        expect(layoutFuer(typ, mermaidConfig(dunkel)), typ).toBe("dagre");
      }
    }
  });

  it("laesst nach einem Syntaxfehler nichts in <body> zurueck", async () => {
    // mermaid baut das Bild in `d<id>` am Ende von <body>. Ohne
    // suppressErrorRendering zeichnet es bei einem Syntaxfehler dort sein
    // Fehlerbild und laesst das Element stehen. Die zweite und dritte
    // Quelle versuchen, den Schluessel per Direktive und per Front Matter
    // wieder abzuschalten; mermaid fuehrt ihn in `secure` und ueberhoert
    // das.
    const quellen = [
      "graph TD\n  A-->",
      '%%{init: {"suppressErrorRendering": false}}%%\ngraph TD\n  A-->',
      "---\nconfig:\n  suppressErrorRendering: false\n---\ngraph TD\n  A-->",
    ];
    for (const [i, quelle] of quellen.entries()) {
      mermaid.initialize(mermaidConfig(false));
      await expect(mermaid.render(`fehler${i}`, quelle)).rejects.toThrow(
        /Parse error/,
      );
      expect(document.getElementById(`dfehler${i}`), quelle).toBeNull();
    }
    expect(document.body.children).toHaveLength(0);
  });

  it("setzt kein globales layout (Mindmaps bleiben bei cose-bilkent)", () => {
    // mermaid nimmt ein layout aus initialize() bei Mindmaps als
    // ausdruecklichen Wunsch und ersetzt dann cose-bilkent.
    expect(mermaidConfig(false)).not.toHaveProperty("layout");
    expect(mermaidConfig(true)).not.toHaveProperty("layout");
  });
});
