"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Minus,
  Table as TableIcon,
  Image as ImageIcon,
  Info,
  CircleCheck,
  TriangleAlert,
  OctagonAlert,
  Workflow,
  Shapes,
  Network,
  MonitorPlay as YoutubeIcon,
} from "lucide-react";
import { SlashMenu, type SlashMenuHandle, type SlashItem } from "./SlashMenu";

type Def = {
  title: string;
  subtitle: string;
  icon: SlashItem["icon"];
  keywords: string;
  run: (editor: Editor, range: Range) => void;
};

export type SlashOptions = {
  onImage: (editor: Editor, range: Range) => void;
};

function defs(opts: SlashOptions): Def[] {
  const chain = (editor: Editor, range: Range) =>
    editor.chain().focus().deleteRange(range);
  return [
    { title: "Text", subtitle: "Normaler Absatz", icon: Type, keywords: "text absatz paragraph", run: (e, r) => chain(e, r).setParagraph().run() },
    { title: "Überschrift 1", subtitle: "Große Überschrift", icon: Heading1, keywords: "h1 titel überschrift heading", run: (e, r) => chain(e, r).setHeading({ level: 1 }).run() },
    { title: "Überschrift 2", subtitle: "Mittlere Überschrift", icon: Heading2, keywords: "h2 überschrift heading", run: (e, r) => chain(e, r).setHeading({ level: 2 }).run() },
    { title: "Überschrift 3", subtitle: "Kleine Überschrift", icon: Heading3, keywords: "h3 überschrift heading", run: (e, r) => chain(e, r).setHeading({ level: 3 }).run() },
    { title: "Aufgabenliste", subtitle: "To-dos mit Checkbox", icon: ListChecks, keywords: "todo task aufgabe checkbox", run: (e, r) => chain(e, r).toggleTaskList().run() },
    { title: "Aufzählung", subtitle: "Liste mit Punkten", icon: List, keywords: "bullet liste ul aufzählung", run: (e, r) => chain(e, r).toggleBulletList().run() },
    { title: "Nummerierte Liste", subtitle: "Geordnete Liste", icon: ListOrdered, keywords: "ordered nummer ol liste", run: (e, r) => chain(e, r).toggleOrderedList().run() },
    { title: "Zitat", subtitle: "Zitatblock", icon: Quote, keywords: "quote zitat blockquote", run: (e, r) => chain(e, r).toggleBlockquote().run() },
    { title: "Codeblock", subtitle: "Formatierter Code", icon: Code2, keywords: "code pre block", run: (e, r) => chain(e, r).toggleCodeBlock().run() },
    { title: "Trennlinie", subtitle: "Horizontaler Strich", icon: Minus, keywords: "hr divider trennlinie linie", run: (e, r) => chain(e, r).setHorizontalRule().run() },
    { title: "Tabelle", subtitle: "3×3 mit Kopfzeile", icon: TableIcon, keywords: "table tabelle grid", run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { title: "Bild", subtitle: "Datei hochladen", icon: ImageIcon, keywords: "image bild foto upload", run: (e, r) => opts.onImage(e, r) },
    { title: "Info-Callout", subtitle: "Hervorgehobener Hinweis", icon: Info, keywords: "callout info hinweis", run: (e, r) => chain(e, r).setCallout("info").run() },
    { title: "Erfolg-Callout", subtitle: "Positiver Hinweis", icon: CircleCheck, keywords: "callout success erfolg", run: (e, r) => chain(e, r).setCallout("success").run() },
    { title: "Warnung-Callout", subtitle: "Warnhinweis", icon: TriangleAlert, keywords: "callout warn warnung", run: (e, r) => chain(e, r).setCallout("warn").run() },
    { title: "Achtung-Callout", subtitle: "Kritischer Hinweis", icon: OctagonAlert, keywords: "callout danger achtung fehler", run: (e, r) => chain(e, r).setCallout("danger").run() },
    { title: "Mermaid-Diagramm", subtitle: "Flussdiagramm aus Code", icon: Workflow, keywords: "mermaid diagramm graph flowchart", run: (e, r) => chain(e, r).setMermaid().run() },
    { title: "Excalidraw-Zeichnung", subtitle: "Freihand skizzieren", icon: Shapes, keywords: "excalidraw zeichnung skizze sketch whiteboard", run: (e, r) => chain(e, r).setExcalidraw().run() },
    { title: "draw.io-Diagramm", subtitle: "Diagramm-Editor (diagrams.net)", icon: Network, keywords: "drawio diagrams flowchart uml architektur", run: (e, r) => chain(e, r).setDrawio().run() },
    {
      title: "YouTube-Video",
      subtitle: "Video einbetten",
      icon: YoutubeIcon,
      keywords: "youtube video embed einbetten",
      run: (e, r) => {
        const src = window.prompt("YouTube-URL:");
        if (src) chain(e, r).setYoutubeVideo({ src }).run();
        else e.chain().focus().deleteRange(r).run();
      },
    },
  ];
}

export function createSlashCommands(opts: SlashOptions) {
  const all = defs(opts);

  return Extension.create({
    name: "slashCommands",

    addProseMirrorPlugins() {
      return [
        Suggestion<Def>({
          editor: this.editor,
          pluginKey: new PluginKey("slashCommands"),
          char: "/",
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }) => {
            const q = query.toLowerCase();
            return all
              .filter(
                (d) =>
                  !q ||
                  d.title.toLowerCase().includes(q) ||
                  d.keywords.includes(q),
              )
              .slice(0, 12);
          },
          command: ({ editor, range, props }) =>
            props.run(editor, range),
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

            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashMenu, {
                  props: {
                    items: (props.items as Def[]).map<SlashItem>((d) => ({
                      title: d.title,
                      subtitle: d.subtitle,
                      icon: d.icon,
                      command: () =>
                        props.command(d as unknown as Record<string, unknown>),
                    })),
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
                  items: (props.items as Def[]).map<SlashItem>((d) => ({
                    title: d.title,
                    subtitle: d.subtitle,
                    icon: d.icon,
                    command: () =>
                      props.command(d as unknown as Record<string, unknown>),
                  })),
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
