import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Wiki-Link auf eine andere Seite ([[Seite]]). Inline-Atom mit
 * pageId + label. Framework-neutral definiert, der Client hängt eine
 * React-NodeView an.
 *
 * `label` ist ein Schnappschuss des Titels beim Verlinken und wird nicht
 * angezeigt: der Editor holt den aktuellen Titel nur für Ziele, die die
 * lesende Person öffnen darf, und Export, Druck, Freigabe und Verlauf
 * setzen ihn vor dem Rendern ein (apps/web lib/link-labels). Links aus
 * dem [[-Vorschlag speichern keinen mehr (null); Kopien bestehender Links
 * (Einfuegen, Duplizieren, Vorlagen) behalten ihn, der Import speichert
 * den Linktext. Beim Kopieren kommt der Schnappschuss als Text und als
 * HTML in die Zwischenablage.
 */
export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-page-id"),
        renderHTML: (attrs) => ({ "data-page-id": attrs.pageId }),
      },
      label: {
        default: "Seite",
        parseHTML: (el) => el.getAttribute("data-label") ?? el.textContent,
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
    };
  },

  parseHTML() {
    // Vor der Link-Marke (a[href], Vorrang 50): in der Zwischenablage
    // steht ein Wiki-Link als <a data-page-id href="/p/…">. Ohne Vorrang
    // wurde er beim Einfuegen ein gewoehnlicher Link mit dem gespeicherten
    // Titel als sichtbarem Text. Der Schema-Hash bleibt gleich: Regeln
    // zum Einlesen stehen nicht darin (schema-hash.ts). Der Import
    // entfernt data-page-id vorher (lib/import/html).
    return [{ tag: "a[data-page-id]", priority: 60 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label ?? "Seite");
    // Ohne Ziel reiner Text: Freigabe, Export und Druck entfernen die ID,
    // weil diese Ausgaben die App verlassen. Ein Verweis auf "/p/null"
    // waere tot und verriete, dass hier ein Link stand.
    if (!node.attrs.pageId) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, { class: "dk-wikilink" }),
        label,
      ];
    }
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        class: "dk-wikilink",
        href: `/p/${node.attrs.pageId}`,
      }),
      label,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.label ?? "Seite"}]]`;
  },
});
