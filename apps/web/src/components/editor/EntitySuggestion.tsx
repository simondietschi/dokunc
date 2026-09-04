"use client";

import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { LucideIcon } from "lucide-react";
import type { SlashItem } from "./SlashMenu";
import { createSuggestionPopup } from "./SuggestionPopup";

type EntityItem = { id: string; label: string; icon?: string | null };

/**
 * Popup-Vervollständigung für Entitäten aus der Suggest-API:
 *   char "[["  -> wikiLink-Node (Seiten)
 *   char "@"   -> mention-Node (Mitglieder)
 */
export function createEntitySuggestion(opts: {
  name: string;
  char: string;
  spaceId: string;
  kind: "pages" | "members";
  nodeType: "wikiLink" | "mention";
  icon: LucideIcon;
  subtitle: string;
}) {
  // Antworten kommen nicht zwingend in Reihenfolge — eine langsamere,
  // ältere Antwort darf die aktuelle Liste nicht überschreiben.
  let latest = 0;
  let lastItems: EntityItem[] = [];
  async function fetchItems(query: string): Promise<EntityItem[]> {
    const seq = ++latest;
    try {
      const res = await fetch(
        `/api/spaces/${opts.spaceId}/suggest?kind=${opts.kind}&q=${encodeURIComponent(query)}`,
      );
      if (seq !== latest) return lastItems;
      if (!res.ok) return [];
      const data = (await res.json()) as { items: EntityItem[] };
      if (seq !== latest) return lastItems;
      lastItems = data.items;
      return data.items;
    } catch {
      return seq === latest ? [] : lastItems;
    }
  }

  return Extension.create({
    name: opts.name,

    addProseMirrorPlugins() {
      return [
        Suggestion<EntityItem>({
          editor: this.editor,
          pluginKey: new PluginKey(opts.name),
          char: opts.char,
          allowSpaces: true,
          items: ({ query }) => fetchItems(query),
          command: ({ editor, range, props }) => {
            const attrs =
              opts.nodeType === "wikiLink"
                ? { pageId: props.id, label: props.label, icon: props.icon ?? null }
                : { userId: props.id, name: props.label };
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                { type: opts.nodeType, attrs },
                { type: "text", text: " " },
              ])
              .run();
          },
          render: createSuggestionPopup<EntityItem>((props) =>
            props.items.map<SlashItem>((it) => ({
              title: it.label,
              subtitle: opts.subtitle,
              icon: it.icon ?? opts.icon,
              command: () => props.command(it),
            })),
          ),
        }),
      ];
    },
  });
}
