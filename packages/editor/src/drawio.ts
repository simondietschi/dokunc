import { Node, mergeAttributes } from "@tiptap/core";
import { toBase64, fromBase64 } from "./excalidraw";

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
      // Das XML MUSS ins HTML: Kopieren/Einfügen serialisiert den Block
      // über renderHTML und liest ihn über parseHTML zurück. Ohne das
      // Attribut greift die Parse-Regel nicht — das Diagramm wäre nach
      // einem Copy-Paste unwiederbringlich weg.
      xml: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-drawio") ?? "",
        renderHTML: (attrs) => ({ "data-drawio": String(attrs.xml ?? "") }),
      },
      // Vorschau aus dem data-URI des Bildes zurücklesen.
      svg: {
        default: "",
        parseHTML: (el) => svgFromPreview(el),
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

/** SVG-Vorschau aus dem data-URI des Vorschaubilds zurücklesen. */
function svgFromPreview(el: HTMLElement): string {
  const src = el.querySelector("img")?.getAttribute("src") ?? "";
  const marker = "base64,";
  const at = src.startsWith("data:image/svg+xml") ? src.indexOf(marker) : -1;
  if (at < 0) return "";
  try {
    return fromBase64(src.slice(at + marker.length));
  } catch {
    return "";
  }
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    drawio: {
      setDrawio: () => ReturnType;
    };
  }
}
