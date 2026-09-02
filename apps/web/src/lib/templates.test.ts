import { describe, it, expect } from "vitest";
import { extractPlainText } from "@dokunc/editor";
import {
  BUILTIN_TEMPLATES,
  BUILTIN_TEMPLATE_META,
  fillTemplate,
  findBuiltinTemplate,
} from "./templates";

describe("Vorlagen", () => {
  it("eingebaute Vorlagen sind eindeutig und haben Inhalt", () => {
    const ids = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(BUILTIN_TEMPLATES.length);
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.content.type).toBe("doc");
      expect(extractPlainText(t.content).length).toBeGreaterThan(20);
    }
    expect(BUILTIN_TEMPLATE_META[0].id).toMatch(/^builtin:/);
  });

  it("enthält keine leeren Textknoten (Collab-Server lehnt sie ab)", () => {
    const hasEmptyText = (n: unknown): boolean => {
      if (!n || typeof n !== "object") return false;
      const node = n as { type?: string; text?: string; content?: unknown[] };
      if (node.type === "text" && !node.text) return true;
      return (node.content ?? []).some(hasEmptyText);
    };
    for (const t of BUILTIN_TEMPLATES) {
      expect(hasEmptyText(t.content), t.id).toBe(false);
    }
  });

  it("findBuiltinTemplate akzeptiert nur builtin:-IDs", () => {
    expect(findBuiltinTemplate("builtin:meeting")?.name).toContain("Meeting");
    expect(findBuiltinTemplate("meeting")).toBeNull();
    expect(findBuiltinTemplate("builtin:nope")).toBeNull();
  });

  it("fillTemplate ersetzt {date} in Titel und Inhalt", () => {
    const d = new Date(2026, 8, 2);
    const t = findBuiltinTemplate("builtin:meeting")!;
    const filled = fillTemplate({ title: t.title, content: t.content }, d);
    expect(filled.title).toBe("Meeting 02.09.2026");
    expect(JSON.stringify(filled.content)).not.toContain("{date}");
    expect(JSON.stringify(filled.content)).toContain("02.09.2026");
  });
});
