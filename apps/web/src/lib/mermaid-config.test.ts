import { describe, expect, it } from "vitest";
import { mermaidConfig } from "./mermaid-config";

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

  it("haelt das Bild von mermaid 11: classic, dagre, 200 px Umbruch", () => {
    const c = mermaidConfig(false);
    expect(c.look).toBe("classic");
    for (const typ of ["flowchart", "state", "class", "er", "requirement"] as const) {
      expect(c[typ]?.layout, typ).toBe("dagre");
    }
    for (const typ of ["flowchart", "state"] as const) {
      expect(c[typ]?.wrappingWidth, typ).toBe(200);
      expect(c[typ]?.minNodeWidth, typ).toBe(0);
    }
  });

  it("setzt kein globales layout (Mindmaps bleiben bei cose-bilkent)", () => {
    // mermaid nimmt ein layout aus initialize() bei Mindmaps als
    // ausdruecklichen Wunsch und ersetzt dann cose-bilkent.
    expect(mermaidConfig(false)).not.toHaveProperty("layout");
    expect(mermaidConfig(true)).not.toHaveProperty("layout");
  });
});
