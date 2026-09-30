// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MermaidView } from "./MermaidView";

/**
 * Verdrahtung der Mermaid-Ansicht mit mermaid.render. mermaid selbst ist
 * hier ersetzt: es baut sein Bild wie das echte in einem Hilfselement
 * `d<id>` am Ende von <body>, und der Test bestimmt, ob der Lauf gelingt.
 * Wie das echte mermaid mit der Konfiguration umgeht, pruefen
 * lib/mermaid-config.test.ts und e2e/mermaid.spec.ts.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

/** Wie mermaid: Hilfselement anlegen, dann gelingen oder scheitern. */
function renderMit(fehler: string | null) {
  mermaid.render.mockImplementation(async (id: string) => {
    const hilfe = document.createElement("div");
    hilfe.id = `d${id}`;
    hilfe.textContent = "Syntax error in text";
    document.body.appendChild(hilfe);
    if (fehler) throw new Error(fehler);
    hilfe.remove();
    return { svg: `<svg id="${id}"><g class="node"></g></svg>` };
  });
}

let roots: Root[] = [];

function block(code: string): (code: string) => Promise<void> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const zeigen = (c: string) =>
    root.render(
      createElement(MermaidView, {
        node: { attrs: { code: c } },
        updateAttributes: vi.fn(),
        editor: { isEditable: true },
      } as never),
    );
  act(() => zeigen(code));
  return async (neu: string) => {
    // Vor dem Aendern zaehlen: der neue Lauf ruft render() erst nach dem
    // dynamischen Import von mermaid auf, also nicht schon in act().
    const bisher = mermaid.render.mock.calls.length;
    act(() => zeigen(neu));
    await laeufe(bisher + 1);
  };
}

/** Wartet, bis mermaid.render so oft aufgerufen wurde und fertig ist. */
async function laeufe(anzahl: number) {
  await act(() =>
    vi.waitFor(async () => {
      expect(mermaid.render).toHaveBeenCalledTimes(anzahl);
      await Promise.allSettled(mermaid.render.mock.results.map((r) => r.value));
    }),
  );
}

const hilfselemente = () =>
  Array.from(document.body.children).filter((e) => /^dmmd-/.test(e.id));

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
});

afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  roots = [];
  document.body.innerHTML = "";
});

describe("MermaidView", () => {
  it("raeumt das Hilfselement eines gescheiterten Laufs weg", async () => {
    renderMit("Parse error on line 2");
    block("graph TD\n  A-->");
    await laeufe(1);
    expect(document.querySelector(".dk-mermaid-error")?.textContent).toBe(
      "Parse error on line 2",
    );
    expect(hilfselemente()).toEqual([]);
  });

  it("gibt jedem Lauf eine eigene id, auch im selben Block", async () => {
    renderMit(null);
    const aendern = block("graph TD\n  A-->B");
    await laeufe(1);
    block("graph TD\n  C-->D");
    await laeufe(2);
    await aendern("graph TD\n  A-->E");

    const ids = mermaid.render.mock.calls.map(([id]) => id as string);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // Das angezeigte Bild traegt die id des letzten Laufs seines Blocks;
    // ein neuer Lauf darf sie nicht wiederverwenden (siehe MermaidView).
    const angezeigt = Array.from(
      document.querySelectorAll(".dk-mermaid-render svg"),
      (s) => s.id,
    );
    expect(angezeigt.sort()).toEqual([ids[1], ids[2]].sort());
    expect(hilfselemente()).toEqual([]);
  });
});
