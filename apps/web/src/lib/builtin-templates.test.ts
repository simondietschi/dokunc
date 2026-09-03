import { describe, it, expect } from "vitest";
import { generateHTML } from "@tiptap/html";
import { richExtensions } from "@dokunc/editor";
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from "./builtin-templates";
import { previewLines } from "./page-text";

const extensions = richExtensions();

describe("Standardvorlagen", () => {
  it("umfasst die fünf erwarteten Vorlagen mit eindeutigen Schlüsseln", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.title)).toEqual([
      "Meeting-Notizen",
      "Entscheidung (ADR)",
      "Runbook",
      "Projektbrief",
      "Wochenbericht",
    ]);
    const keys = BUILTIN_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(BUILTIN_TEMPLATES.map((t) => [t.title, t] as const))(
    "%s lässt sich mit dem geteilten Schema rendern",
    (_title, template) => {
      const html = generateHTML(template.content, extensions);
      expect(html).toContain("<h2>");
      expect(html.length).toBeGreaterThan(200);
      // Vorschau liefert Zeilen aus dem Inhalt
      expect(previewLines(template.content).length).toBeGreaterThan(3);
    },
  );

  it("verwendet keine ß-Schreibweise", () => {
    expect(JSON.stringify(BUILTIN_TEMPLATES)).not.toContain("ß");
  });

  it("getBuiltinTemplate() findet per Schlüssel", () => {
    expect(getBuiltinTemplate("meeting")?.title).toBe("Meeting-Notizen");
    expect(getBuiltinTemplate("gibt-es-nicht")).toBeNull();
  });
});
