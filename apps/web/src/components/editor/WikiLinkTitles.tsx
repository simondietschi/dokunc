"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { TitelStand, TitleStore } from "@/lib/wiki-link-titles";

/**
 * Titelspeicher der Wiki-Links für die NodeViews des Editors
 * (lib/wiki-link-titles). Tiptap rendert NodeViews per Portal innerhalb
 * von EditorContent; ein Provider um den Editor erreicht sie.
 */

const Kontext = createContext<TitleStore | null>(null);

export function WikiLinkTitlesProvider({
  store,
  children,
}: {
  store: TitleStore;
  children: React.ReactNode;
}) {
  return <Kontext.Provider value={store}>{children}</Kontext.Provider>;
}

const OHNE_SPEICHER: TitelStand = Object.freeze({ status: "fehler" });
const keinAbo = () => () => {};

/**
 * Stand des Titels für ein Ziel; fordert ihn an, solange er fehlt. Ohne
 * Provider "fehler": der Link zeigt dann einen neutralen Text, nie den
 * gespeicherten Titel.
 */
export function useWikiLinkTitle(pageId: string | null): TitelStand {
  const store = useContext(Kontext);
  useEffect(() => {
    if (store && pageId) store.request(pageId);
  }, [store, pageId]);
  const lies = () => (store ? store.get(pageId) : OHNE_SPEICHER);
  return useSyncExternalStore(store ? store.subscribe : keinAbo, lies, lies);
}
