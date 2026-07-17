import { Node, mergeAttributes } from "@tiptap/core";
import { toBase64 } from "./excalidraw";

/**
 * draw.io-Diagramm als Atom-Block (bearbeitet via embed.diagrams.net).
 * - `xml`: draw.io-XML des Diagramms
 * - `svg`: SVG-Vorschau (nur als data-URI in <img> gerendert — kein
 *   Inline-SVG, damit kein Skript ausgeführt werden kann)
 */
export const Drawio = Node.create({
  name: "drawio",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      // Quelldaten leben nur im JSON/Yjs-Dokument — sie werden bewusst
      // NICHT ins HTML gerendert (Export enthält nur die img-Vorschau).
      xml: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-drawio") ?? "",
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
    return [{ tag: "div[data-drawio]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const svg = String(node.attrs.svg ?? "");
    const children: unknown[] = svg
      ? [
          [
            "img",
            {
              src: `data:image/svg+xml;base64,${toBase64(svg)}`,
              alt: "draw.io-Diagramm",
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
      setDrawio:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { xml: "", svg: "" },
          }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    drawio: {
      setDrawio: () => ReturnType;
    };
  }
}
