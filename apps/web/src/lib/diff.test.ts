import { describe, it, expect } from "vitest";
import { diffText, diffWords, splitLines, type DiffBlock } from "./diff";

/** Rekonstruiert alte bzw. neue Seite aus den Bloecken (Roundtrip-Check). */
function reconstruct(blocks: DiffBlock[], side: "old" | "new"): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "equal") out.push(...b.lines);
    else if (b.kind === "removed") {
      if (side === "old") out.push(...b.lines);
    } else if (b.kind === "added") {
      if (side === "new") out.push(...b.lines);
    } else {
      for (const l of b.lines) {
        const tokens = side === "old" ? l.removed : l.added;
        out.push(tokens.map((t) => t.text).join(""));
      }
    }
  }
  return out;
}

describe("splitLines()", () => {
  it("leer -> keine Zeilen, Endumbruch erzeugt keine Extra-Zeile", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
  });
});

describe("diffText()", () => {
  it("identische Texte -> nur equal, keine Aenderungen", () => {
    const d = diffText("# Titel\n\nHallo\n", "# Titel\n\nHallo\n");
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.blocks).toEqual([{ kind: "equal", lines: ["# Titel", "", "Hallo"] }]);
  });

  it("beide leer -> keine Bloecke", () => {
    const d = diffText("", "");
    expect(d.blocks).toEqual([]);
    expect(d.added + d.removed).toBe(0);
  });

  it("Einfuegung", () => {
    const d = diffText("a\nb\n", "a\nx\nb\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    expect(d.blocks).toEqual([
      { kind: "equal", lines: ["a"] },
      { kind: "added", lines: ["x"] },
      { kind: "equal", lines: ["b"] },
    ]);
  });

  it("Loeschung", () => {
    const d = diffText("a\nx\nb\n", "a\nb\n");
    expect(d.added).toBe(0);
    expect(d.removed).toBe(1);
    expect(d.blocks).toEqual([
      { kind: "equal", lines: ["a"] },
      { kind: "removed", lines: ["x"] },
      { kind: "equal", lines: ["b"] },
    ]);
  });

  it("Aenderung einer Zeile -> changed mit Wort-Diff", () => {
    const d = diffText(
      "Der schnelle Fuchs springt\n",
      "Der langsame Fuchs springt\n",
    );
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.blocks).toHaveLength(1);
    const block = d.blocks[0];
    expect(block.kind).toBe("changed");
    if (block.kind !== "changed") return;
    const removed = block.lines[0].removed.filter((t) => t.kind === "removed");
    const added = block.lines[0].added.filter((t) => t.kind === "added");
    expect(removed.map((t) => t.text)).toEqual(["schnelle"]);
    expect(added.map((t) => t.text)).toEqual(["langsame"]);
  });

  it("voellig verschiedene Zeilen bleiben entfernt/hinzugefuegt", () => {
    const d = diffText("alpha beta gamma\n", "eins zwei drei vier\n");
    expect(d.blocks.map((b) => b.kind)).toEqual(["removed", "added"]);
  });

  it("von leer zu Inhalt und zurueck", () => {
    const up = diffText("", "a\nb\n");
    expect(up.blocks).toEqual([{ kind: "added", lines: ["a", "b"] }]);
    expect(up.added).toBe(2);
    const down = diffText("a\nb\n", "");
    expect(down.blocks).toEqual([{ kind: "removed", lines: ["a", "b"] }]);
    expect(down.removed).toBe(2);
  });

  it("Roundtrip: Bloecke ergeben wieder beide Seiten", () => {
    const oldText = [
      "# Titel",
      "",
      "Erster Absatz mit Text.",
      "- Punkt eins",
      "- Punkt zwei",
      "",
      "Schluss.",
    ].join("\n");
    const newText = [
      "# Neuer Titel",
      "",
      "Erster Absatz mit mehr Text.",
      "- Punkt eins",
      "- Punkt drei",
      "- Punkt vier",
      "",
      "Schluss.",
      "Nachsatz.",
    ].join("\n");
    const d = diffText(oldText, newText);
    expect(reconstruct(d.blocks, "old")).toEqual(splitLines(oldText));
    expect(reconstruct(d.blocks, "new")).toEqual(splitLines(newText));
    expect(d.added).toBeGreaterThan(0);
    expect(d.removed).toBeGreaterThan(0);
  });

  it("groessere Texte in vertretbarer Zeit", () => {
    const base = Array.from({ length: 1500 }, (_, i) => `Zeile ${i}`);
    const changed = base.map((l, i) => (i % 50 === 0 ? `${l} geändert` : l));
    changed.splice(700, 0, "eingefügt");
    const started = Date.now();
    const d = diffText(base.join("\n"), changed.join("\n"));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(reconstruct(d.blocks, "old")).toEqual(base);
    expect(reconstruct(d.blocks, "new")).toEqual(changed);
  });
});

describe("diffWords()", () => {
  it("behaelt Leerraum und setzt Tokens zusammen", () => {
    const r = diffWords("a  b c", "a  b d");
    expect(r.removed.map((t) => t.text).join("")).toBe("a  b c");
    expect(r.added.map((t) => t.text).join("")).toBe("a  b d");
    expect(r.removed.map((t) => t.kind)).toEqual(["equal", "removed"]);
    expect(r.added.map((t) => t.kind)).toEqual(["equal", "added"]);
  });

  it("identisch -> nur equal", () => {
    const r = diffWords("gleich", "gleich");
    expect(r.removed).toEqual([{ kind: "equal", text: "gleich" }]);
    expect(r.added).toEqual([{ kind: "equal", text: "gleich" }]);
  });
});
