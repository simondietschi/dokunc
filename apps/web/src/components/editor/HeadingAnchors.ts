import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { tocEligible, uniqueHeadingIds } from "@dokunc/editor";

export type HeadingInfo = {
  id: string;
  level: number;
  text: string;
  pos: number;
};

/**
 * Überschriften (Level 1..3) mit Position und Anker-ID aus dem Dokument.
 * Dieselbe ID-Ableitung wie im Export (`extractHeadings`), damit Links
 * mit #anker im Editor und in exportiertem HTML gleich funktionieren.
 */
export function collectHeadings(doc: PMNode): HeadingInfo[] {
  const found: Omit<HeadingInfo, "id">[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    const level = Number(node.attrs.level ?? 1);
    const text = node.textContent.trim();
    if (tocEligible(level, text)) found.push({ level, text, pos });
    return false;
  });
  const ids = uniqueHeadingIds(found.map((f) => f.text));
  return found.map((f, i) => ({ ...f, id: ids[i] }));
}

const key = new PluginKey<DecorationSet>("headingAnchors");

function build(doc: PMNode): DecorationSet {
  return DecorationSet.create(
    doc,
    collectHeadings(doc).map((h) =>
      Decoration.node(h.pos, h.pos + doc.nodeAt(h.pos)!.nodeSize, {
        id: h.id,
      }),
    ),
  );
}

/**
 * Setzt `id`-Attribute auf Überschriften als Decoration (nicht im
 * Dokument gespeichert, daher kein Schema-/Yjs-Eingriff).
 */
export const HeadingAnchors = Extension.create({
  name: "headingAnchors",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) =>
            tr.docChanged ? build(tr.doc) : old.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});
