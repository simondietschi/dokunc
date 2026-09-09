import { describe, it, expect } from "vitest";
import { extractText, previewLines } from "./page-text";

const t = (text: string) => ({ type: "text", text });
const para = (...content: unknown[]) =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [t("Agenda")] },
    para(),
    {
      type: "orderedList",
      content: [
        { type: "listItem", content: [para(t("Erstes"))] },
        { type: "listItem", content: [para(t("Zweites"))] },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [para(t("Erledigt"))],
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [para(t("Option"))] },
            { type: "tableHeader", content: [para(t("Aufwand"))] },
          ],
        },
      ],
    },
    para(
      t("Siehe "),
      { type: "wikiLink", attrs: { pageId: "p1", label: "Runbook" } },
      t("  und  "),
      { type: "mention", attrs: { userId: "u1", name: "Alex" } },
    ),
  ],
};

describe("previewLines()", () => {
  it("liefert eine Zeile pro Block mit Listen- und Tabellenzeichen", () => {
    expect(previewLines(doc)).toEqual([
      "Agenda",
      "1. Erstes",
      "2. Zweites",
      "[x] Erledigt",
      "Option | Aufwand",
      "Siehe Runbook und @Alex",
    ]);
  });

  it("respektiert das Zeilenlimit", () => {
    expect(previewLines(doc, 2)).toEqual(["Agenda", "1. Erstes"]);
    expect(previewLines(doc, 0)).toEqual([]);
  });

  it("ungültiger Input ergibt leere Liste", () => {
    expect(previewLines(null)).toEqual([]);
    expect(previewLines("x")).toEqual([]);
  });
});

describe("extractText()", () => {
  it("verbindet alle Textknoten mit Leerzeichen", () => {
    const text = extractText(doc);
    expect(text).toContain("Agenda");
    expect(text).toContain("Erstes");
    expect(text).toContain("Siehe");
    expect(extractText(null)).toBe("");
  });
});
