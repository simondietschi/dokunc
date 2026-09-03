import { describe, it, expect } from "vitest";
import {
  stripCommentMarks,
  copyTitle,
  planSubtreeCopy,
  type CopySource,
} from "./page-copy";

describe("stripCommentMarks()", () => {
  it("entfernt commentMark, behält andere Marks und mutiert nicht", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Hallo",
              marks: [
                { type: "bold" },
                { type: "commentMark", attrs: { commentId: "c1" } },
              ],
            },
            {
              type: "text",
              text: "Welt",
              marks: [{ type: "commentMark", attrs: { commentId: "c2" } }],
            },
          ],
        },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(doc));
    const out = stripCommentMarks(doc);
    // Original bleibt unverändert
    expect(doc).toEqual(snapshot);
    const para = out.content[0];
    expect(para.content[0].marks).toEqual([{ type: "bold" }]);
    expect(para.content[1]).not.toHaveProperty("marks");
    expect(JSON.stringify(out)).not.toContain("commentMark");
  });

  it("arbeitet rekursiv in verschachtelten Blöcken", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { type: "info" },
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "tief",
                          marks: [
                            { type: "commentMark", attrs: { commentId: "x" } },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const json = JSON.stringify(stripCommentMarks(doc));
    expect(json).not.toContain("commentMark");
    expect(json).toContain("tief");
  });

  it("lässt null und Primitive unverändert", () => {
    expect(stripCommentMarks(null)).toBeNull();
    expect(stripCommentMarks("x")).toBe("x");
  });
});

describe("copyTitle()", () => {
  it("hängt (Kopie) an", () => {
    expect(copyTitle("Onboarding")).toBe("Onboarding (Kopie)");
    expect(copyTitle("  ")).toBe("Untitled (Kopie)");
  });
});

describe("planSubtreeCopy()", () => {
  const pages: CopySource[] = [
    { id: "root", parentId: null, title: "Wurzel", position: 3 },
    { id: "b", parentId: "root", title: "B", position: 1 },
    { id: "a", parentId: "root", title: "A", position: 0 },
    { id: "a1", parentId: "a", title: "A1", position: 0 },
    { id: "other", parentId: null, title: "Anderes", position: 4 },
    { id: "other-child", parentId: "other", title: "Fremd", position: 0 },
  ];

  it("ohne Unterseiten: nur die Wurzel mit Kopie-Titel und Zielposition", () => {
    const steps = planSubtreeCopy(pages, "root", {
      withChildren: false,
      rootPosition: 4,
    });
    expect(steps).toEqual([
      {
        sourceId: "root",
        parentSourceId: null,
        title: "Wurzel (Kopie)",
        position: 4,
      },
    ]);
  });

  it("mit Unterseiten: Eltern vor Kindern, Geschwister nach Position", () => {
    const steps = planSubtreeCopy(pages, "root", {
      withChildren: true,
      rootPosition: 4,
    });
    expect(steps.map((s) => s.sourceId)).toEqual(["root", "a", "b", "a1"]);
    expect(steps[1]).toEqual({
      sourceId: "a",
      parentSourceId: "root",
      title: "A",
      position: 0,
    });
    expect(steps[3].parentSourceId).toBe("a");
    // Fremder Teilbaum bleibt aussen vor
    expect(steps.some((s) => s.sourceId === "other-child")).toBe(false);
  });

  it("unbekannte Wurzel ergibt leeren Plan, Zyklen enden", () => {
    expect(
      planSubtreeCopy(pages, "nope", { withChildren: true, rootPosition: 0 }),
    ).toEqual([]);
    const cyclic: CopySource[] = [
      { id: "r", parentId: "c", title: "R", position: 0 },
      { id: "c", parentId: "r", title: "C", position: 0 },
    ];
    const steps = planSubtreeCopy(cyclic, "r", {
      withChildren: true,
      rootPosition: 0,
    });
    expect(steps.map((s) => s.sourceId)).toEqual(["r", "c"]);
  });
});
