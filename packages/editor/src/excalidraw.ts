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
      // Die Szene MUSS ins HTML: Kopieren/Einfügen serialisiert den Block
      // über renderHTML und liest ihn über parseHTML zurück. Ohne das
      // Attribut greift die Parse-Regel nicht — die Zeichnung wäre nach
      // einem Copy-Paste (und in jedem exportierten und wieder
      // importierten HTML) unwiederbringlich weg.
      data: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-excalidraw") ?? "",
        renderHTML: (attrs) => ({
          "data-excalidraw": String(attrs.data ?? ""),
        }),
      },
      // Die Vorschau steckt als data-URI im <img>; von dort wird sie beim
      // Einfügen zurückgelesen, damit die Kopie sofort etwas anzeigt.
      svg: {
        default: "",
        parseHTML: (el) => svgFromPreview(el),
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

/** Unicode-sicheres Base64 (auch serverseitig ohne DOM). */
export function toBase64(s: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(s, "utf-8").toString("base64");
  }
  return btoa(unescape(encodeURIComponent(s)));
}

/** Gegenstueck zu toBase64. */
export function fromBase64(s: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(s, "base64").toString("utf-8");
  }
  return decodeURIComponent(escape(atob(s)));
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    excalidraw: {
      setExcalidraw: () => ReturnType;
    };
  }
}
