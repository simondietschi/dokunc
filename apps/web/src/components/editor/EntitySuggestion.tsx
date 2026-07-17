"use client";

import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import { SlashMenu, type SlashMenuHandle, type SlashItem } from "./SlashMenu";

type EntityItem = { id: string; label: string };

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
  async function fetchItems(query: string): Promise<EntityItem[]> {
    try {
      const res = await fetch(
        `/api/spaces/${opts.spaceId}/suggest?kind=${opts.kind}&q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { items: EntityItem[] };
      return data.items;
    } catch {
      return [];
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
                ? { pageId: props.id, label: props.label }
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
          render: () => {
            let component: ReactRenderer<SlashMenuHandle> | null = null;
            let el: HTMLDivElement | null = null;

            const position = (rect: DOMRect | null) => {
              if (!el || !rect) return;
              el.style.position = "fixed";
              el.style.left = `${rect.left}px`;
              el.style.top = `${rect.bottom + 6}px`;
              el.style.zIndex = "60";
            };

            const toItems = (
              items: EntityItem[],
              command: (item: EntityItem) => void,
            ): SlashItem[] =>
              items.map((it) => ({
                title: it.label,
                subtitle: opts.subtitle,
                icon: opts.icon,
                command: () => command(it),
              }));

            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashMenu, {
                  props: {
                    items: toItems(props.items, (it) =>
                      props.command(it),
                    ),
                  },
                  editor: props.editor,
                });
                el = document.createElement("div");
                el.appendChild(component.element);
                document.body.appendChild(el);
                position(props.clientRect?.() ?? null);
              },
              onUpdate: (props) => {
                component?.updateProps({
                  items: toItems(props.items, (it) => props.command(it)),
                });
                position(props.clientRect?.() ?? null);
              },
              onKeyDown: (props) => {
                if (props.event.key === "Escape") return true;
                return component?.ref?.onKeyDown(props.event) ?? false;
              },
              onExit: () => {
                el?.remove();
                component?.destroy();
                el = null;
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}
