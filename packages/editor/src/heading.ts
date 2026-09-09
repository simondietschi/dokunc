import Heading from "@tiptap/extension-heading";
import { mergeAttributes } from "@tiptap/core";
import { headingSlug } from "./text";

/**
 * Überschrift mit Anker.
 *
 * Die Kennung wird beim Rendern aus dem Text abgeleitet statt im
 * Dokument gespeichert: sonst müsste sie bei jeder Textänderung
 * nachgeführt werden und wäre nach einer Umbenennung falsch. So gilt
 * derselbe Anker im Editor, im HTML-Export und im Druck.
 */
export const AnchoredHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level: number = this.options.levels.includes(node.attrs.level)
      ? node.attrs.level
      : this.options.levels[0];
    return [
      `h${level}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        id: headingSlug(node.textContent),
      }),
      0,
    ];
  },
});
