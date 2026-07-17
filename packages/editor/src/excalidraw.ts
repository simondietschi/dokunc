import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Excalidraw-Zeichnung als Atom-Block.
 * - `data`: Szene-JSON (Elemente + AppState-Ausschnitt) als String
 * - `svg`: gerendertes SVG als Vorschau (wird NUR als data-URI in einem
 *   <img> gerendert — nie inline, damit kein Skript ausgeführt wird)
 */
export const Excalidraw = Node.create({
  name: "excalidraw",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      // Quelldaten leben nur im JSON/Yjs-Dokument — sie werden bewusst
      // NICHT ins HTML gerendert (Export enthält nur die img-Vorschau).
      data: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-excalidraw") ?? "",
        renderHTML: () => ({}),
      },
      svg: {
        default: "",
        parseHTML: () => "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-excalidraw]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const svg = String(node.attrs.svg ?? "");
    const children: unknown[] = svg
      ? [
          [
            "img",
            {
              src: `data:image/svg+xml;base64,${toBase64(svg)}`,
              alt: "Excalidraw-Zeichnung",
              class: "dk-diagram-img",
            },
          ],
        ]
      : [];
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "dk-diagram" }),
      ...(children as never[]),
    ];
  },

  addCommands() {
    return {
      setExcalidraw:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { data: "", svg: "" },
          }),
    };
  },
});

/** Unicode-sicheres Base64 (auch serverseitig ohne DOM). */
export function toBase64(s: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(s, "utf-8").toString("base64");
  }
  return btoa(unescape(encodeURIComponent(s)));
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    excalidraw: {
      setExcalidraw: () => ReturnType;
    };
  }
}
