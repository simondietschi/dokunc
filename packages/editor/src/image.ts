import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";

/** Anzeigebreiten eines Bildes. Prozentwerte stehen im CSS. */
export const IMAGE_WIDTHS = ["small", "medium", "full"] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

/**
 * Bild mit Alternativtext, Breite und Bildunterschrift.
 *
 * Mit Unterschrift wird ein `figure` gerendert, ohne bleibt es ein
 * nacktes `img` — so bleibt bestehender Inhalt unverändert und der
 * Export bekommt trotzdem eine echte Bildunterschrift.
 */
export const RichImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "full" as ImageWidth,
        parseHTML: (el) => el.getAttribute("data-width") ?? "full",
        renderHTML: (attrs) => ({ "data-width": attrs.width ?? "full" }),
      },
      caption: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-caption"),
        // Nur setzen, wenn vorhanden: sonst stünde data-caption="" an
        // jedem Bild.
        renderHTML: (attrs) =>
          attrs.caption ? { "data-caption": attrs.caption } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure.dk-figure",
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const img = el.querySelector("img");
          if (!img) return false;
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            title: img.getAttribute("title"),
            width: el.getAttribute("data-width") ?? "full",
            caption: el.querySelector("figcaption")?.textContent || null,
          };
        },
      },
      { tag: "img[src]" },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const img: [string, Record<string, unknown>] = [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
    const caption = node.attrs.caption as string | null;
    if (!caption) return img;
    return [
      "figure",
      { class: "dk-figure", "data-width": node.attrs.width ?? "full" },
      img,
      ["figcaption", {}, caption],
    ];
  },
});
