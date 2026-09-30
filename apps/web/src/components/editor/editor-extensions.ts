import { Extension, type AnyExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
// @tiptap/extension-placeholder ist seit v3 eine leere Weiterleitung
// auf @tiptap/extensions und liegt im Tiptap-Repo unter
// packages-deprecated; direkt aus der Quelle importiert.
import { Placeholder } from "@tiptap/extensions";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import { COLLAB_FIELD, richExtensions } from "@dokunc/editor";

/**
 * Cmd/Ctrl+Klick öffnet einen Link auch im Bearbeitungsmodus (der
 * normale Klick setzt den Cursor, damit man Linktext editieren kann).
 */
const LinkClick = Extension.create({
  name: "linkClick",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkClick"),
        props: {
          handleClick(view, _pos, event) {
            if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
              return false;
            }
            const a = (event.target as HTMLElement | null)?.closest?.(
              "a[href]",
            );
            if (!a || !view.dom.contains(a) || a.classList.contains("dk-wikilink")) {
              return false;
            }
            const href = a.getAttribute("href") ?? "";
            if (!/^(https?:|mailto:|tel:)/i.test(href)) return false;
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Alle Erweiterungen des Editors im Browser (CollaborativeEditor), an
 * einer Stelle.
 *
 * Das Schema des Browsers muss dem des Collab-Servers gleichen, der nur
 * richExtensions() ohne NodeViews laedt: ein Tab mit mehr oder anderen
 * Attributen schriebe sie ins gemeinsame Dokument, und der Server
 * verwuerfe sie beim Speichern oder ein anderer Tab loeschte sie. Die
 * Web-App prueft beim Ticket nur den Hash von editorSchema(), also dem
 * Schema des Servers. Was hier dazukommt, muss deshalb ohne Schema sein
 * (Plugins, Tastenkuerzel, Vorschlaege); das prueft
 * ./editor-extensions.test.ts. Eine neue Erweiterung des Editors gehoert
 * hierher, nicht direkt in die Liste der Komponente.
 */
export function editorExtensions(o: {
  /** NodeView-Fabriken (React), die der Server weglaesst. */
  views: Parameters<typeof richExtensions>[0];
  placeholder: string;
  /** Erst nach dem Aufbau des Providers; vorher ist der Editor Platzhalter. */
  collab: {
    ydoc: Y.Doc;
    provider: HocuspocusProvider;
    user: { name: string; color: string };
  } | null;
  /** Slash-Befehle, Wiki-Links, Erwähnungen. */
  vorschlaege: AnyExtension[];
}): AnyExtension[] {
  return [
    ...(richExtensions(o.views) as AnyExtension[]),
    LinkClick,
    Placeholder.configure({ placeholder: o.placeholder, includeChildren: true }),
    ...(o.collab
      ? [
          Collaboration.configure({
            document: o.collab.ydoc,
            field: COLLAB_FIELD,
          }),
          CollaborationCaret.configure({
            provider: o.collab.provider,
            user: o.collab.user,
          }),
        ]
      : []),
    ...o.vorschlaege,
  ];
}
