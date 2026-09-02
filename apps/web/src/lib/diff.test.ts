import { describe, it, expect } from "vitest";
import { diffSequences, diffStats, diffText } from "./diff";

const apply = <T>(ops: ReturnType<typeof diffSequences<T>>) => ({
  a: ops.filter((o) => o.type !== "insert").map((o) => o.value),
  b: ops.filter((o) => o.type !== "delete").map((o) => o.value),
});

describe("diffSequences()", () => {
  it("rekonstruiert beide Seiten und ist minimal", () => {
    const a = "a b c d e f".split(" ");
    const b = "a x c d f g".split(" ");
    const ops = diffSequences(a, b);
    expect(apply(ops)).toEqual({ a, b });
    const edits = ops.filter((o) => o.type !== "equal").length;
    expect(edits).toBe(4); // -b +x -e +g
  });

  it("behandelt leere Eingaben und identische Folgen", () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences(["a"], []).map((o) => o.type)).toEqual(["delete"]);
    expect(diffSequences([], ["a"]).map((o) => o.type)).toEqual(["insert"]);
    expect(diffSequences(["a", "b"], ["a", "b"]).every((o) => o.type === "equal")).toBe(true);
  });

  it("fällt bei sehr grossen Eingaben auf grob zurück, bleibt aber korrekt", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `l${i}`);
    const b = [...a, "x"];
    const ops = diffSequences(a, b);
    expect(apply(ops)).toEqual({ a, b });
  });
});

describe("diffText()", () => {
  it("verfeinert geänderte Zeilen wortweise", () => {
    const lines = diffText("Hallo Welt\nZeile zwei", "Hallo schöne Welt\nZeile zwei");
    expect(lines.map((l) => l.type)).toEqual(["delete", "insert", "equal"]);
    const ins = lines[1].segments;
    expect(ins.filter((s) => s.type === "insert").map((s) => s.text).join("")).toBe(
      "schöne ",
    );
    expect(ins.map((s) => s.text).join("")).toBe("Hallo schöne Welt");
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
  });

  it("markiert reine Einfügungen/Löschungen als ganze Zeilen", () => {
    const lines = diffText("a\nb", "a\nb\nc\nd");
    expect(lines.map((l) => l.type)).toEqual(["equal", "equal", "insert", "insert"]);
    expect(lines[2].segments).toEqual([{ type: "insert", text: "c" }]);
  });

  it("identische Texte ergeben nur equal", () => {
    expect(diffText("x\ny", "x\ny").every((l) => l.type === "equal")).toBe(true);
  });
});
