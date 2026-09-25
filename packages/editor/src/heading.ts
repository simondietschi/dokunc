import Heading from "@tiptap/extension-heading";
import { Decoration, mergeAttributes } from "@tiptap/core";
import { headingSlug } from "./text";

/**
 * Überschrift mit Anker.
 *
 * Die Kennung wird aus dem Text abgeleitet statt im Dokument
 * gespeichert: sonst müsste sie bei jeder Textänderung nachgeführt
 * werden und wäre nach einer Umbenennung falsch. So gilt derselbe Anker
 * im Editor, im HTML-Export und im Druck.
 *
 * Zwei Stellen setzen sie, weil keine allein beide Fälle trifft:
 *
 * - `renderHTML` für alles, was frisch gerendert wird: HTML-Export,
 *   Druck, und das erste Zeichnen im Editor.
 * - `addDecorations` für den laufenden Editor. ProseMirror baut das
 *   Element einer Überschrift beim Tippen nicht neu, es tauscht nur den
 *   Text darin; die id aus `renderHTML` bliebe auf dem Stand, den die
 *   Überschrift beim Entstehen hatte. Die Eingaberegel ("### ") macht sie
 *   aber schon aus der leeren Zeile, dort hiesse jede Überschrift
 *   "abschnitt". Die Attribute einer Knoten-Dekoration gleicht
 *   ProseMirror dagegen bei jeder Änderung ab.
 *
 * Das Schema bleibt unberührt (Dekorationen gibt es nur in einer
 * Editor-Ansicht), der Collab-Server sieht also dasselbe wie vorher.
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

  addDecorations() {
    const name = this.name;
    return {
      // Neu berechnet bei jeder Dokumentänderung, auch bei entfernten
      // (Yjs): jede kann den Text einer Überschrift ändern.
      create: ({ state }) => {
        const out: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === name) {
            out.push(
              Decoration.Node(pos, pos + node.nodeSize, {
                id: headingSlug(node.textContent),
              }),
            );
          }
          // In einem Textblock (die Überschrift ist selbst einer) steht
          // keine Überschrift mehr: seinen Inhalt nicht Zeichen für
          // Zeichen durchgehen.
          return !node.isTextblock;
        });
        return out;
      },
    };
  },
});
