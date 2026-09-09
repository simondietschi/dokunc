"use client";

import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { SlashMenu, type SlashMenuHandle, type SlashItem } from "./SlashMenu";

const GAP = 6;
const MARGIN = 8;

/**
 * Gemeinsames Popup für Slash-Befehle, Wiki-Links und Mentions.
 * Hängt unter dem Caret; reicht der Platz nach unten nicht, klappt es
 * nach oben. Bleibt horizontal im Viewport und folgt beim Scrollen
 * (position: fixed würde sonst am alten Ort kleben bleiben).
 */
export function createSuggestionPopup<T>(
  toItems: (props: SuggestionProps<T>) => SlashItem[],
) {
  return () => {
    let component: ReactRenderer<SlashMenuHandle> | null = null;
    let el: HTMLDivElement | null = null;
    let getRect: (() => DOMRect | null) | null = null;
    let raf = 0;

    const position = () => {
      if (!el) return;
      const rect = getRect?.();
      if (!rect) return;
      const menu = el.firstElementChild as HTMLElement | null;
      const h = menu?.offsetHeight ?? 0;
      const w = menu?.offsetWidth ?? 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = rect.bottom + GAP;
      if (top + h > vh - MARGIN && rect.top - GAP - h >= MARGIN) {
        top = rect.top - GAP - h;
      }
      top = Math.max(MARGIN, Math.min(top, vh - MARGIN - h));
      const left = Math.max(MARGIN, Math.min(rect.left, vw - MARGIN - w));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };

    // Nach dem React-Render nochmals messen (Höhe ändert sich mit den Items).
    const schedule = () => {
      position();
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        position();
      });
    };

    return {
      onStart: (props: SuggestionProps<T>) => {
        component = new ReactRenderer(SlashMenu, {
          props: { items: toItems(props) },
          editor: props.editor,
        });
        el = document.createElement("div");
        el.style.position = "fixed";
        el.style.left = "0";
        el.style.top = "0";
        el.style.zIndex = "60";
        el.appendChild(component.element);
        document.body.appendChild(el);
        getRect = props.clientRect ?? null;
        schedule();
        window.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
      },
      onUpdate: (props: SuggestionProps<T>) => {
        component?.updateProps({ items: toItems(props) });
        getRect = props.clientRect ?? null;
        schedule();
      },
      onKeyDown: (props: SuggestionKeyDownProps) =>
        component?.ref?.onKeyDown(props.event) ?? false,
      onExit: () => {
        window.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        el?.remove();
        component?.destroy();
        el = null;
        component = null;
        getRect = null;
      },
    };
  };
}
