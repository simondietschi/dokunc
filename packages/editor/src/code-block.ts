import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

/**
 * Syntax-Highlighting für Code-Blöcke.
 *
 * `common` ist die kuratierte Sprachliste von highlight.js (rund 35
 * Sprachen, von JavaScript bis SQL). Sie wird bewusst als Ganzes
 * geladen statt einzeln zusammengestellt: das Bündel ist gegenüber
 * Excalidraw und Mermaid im selben Editor klein, und eine handgepflegte
 * Liste veraltet still.
 *
 * Die Instanz muss für Client UND Collab-Server dieselbe sein, sonst
 * unterscheiden sich die Schemata.
 */
export const lowlight = createLowlight(common);

/** Auswählbare Sprachen, alphabetisch. */
export const CODE_LANGUAGES: string[] = lowlight.listLanguages().sort();

/**
 * Baut die Erweiterung. Der Client reicht eine NodeView herein
 * (Sprachwahl + Kopieren), der Server lässt sie weg.
 */
export function codeBlockExtension(view?: () => unknown) {
  const base = view
    ? CodeBlockLowlight.extend({ addNodeView: view as never })
    : CodeBlockLowlight;
  return base.configure({
    lowlight,
    defaultLanguage: null,
    HTMLAttributes: { class: "dk-code" },
  });
}
