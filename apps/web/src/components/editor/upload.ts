"use client";

import type { Editor, Range } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";

/** Antwort von /api/upload. */
export type UploadResult = {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  kind: "image" | "file";
};

export type UploadContext = { spaceId: string; pageId: string };

/** Nur diese Typen werden inline als Bild eingebettet (SVG bewusst nicht). */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/**
 * Datei an /api/upload schicken. Wirft mit der Server-Fehlermeldung
 * (z. B. "Datei zu gross (max. 50 MB)"), damit der Aufrufer sie zeigen kann.
 */
export async function uploadFile(
  file: File,
  ctx: UploadContext,
): Promise<UploadResult> {
  const body = new FormData();
  body.set("file", file);
  body.set("spaceId", ctx.spaceId);
  body.set("pageId", ctx.pageId);
  const res = await fetch("/api/upload", { method: "POST", body });
  if (!res.ok) {
    let message = "Upload fehlgeschlagen.";
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new Error(message);
  }
  return (await res.json()) as UploadResult;
}

/** ProseMirror-JSON fuer ein Upload-Ergebnis (Bild oder Anhang). */
export function nodeForUpload(result: UploadResult) {
  if (result.kind === "image") {
    return { type: "image", attrs: { src: result.url, alt: result.name } };
  }
  return {
    type: "attachment",
    attrs: {
      src: result.url,
      name: result.name,
      size: result.size,
      mimeType: result.mimeType,
    },
  };
}

/**
 * Bloecke an `pos` (Drop-Position) oder an der Auswahl einfuegen.
 * replaceRange/replaceSelection nutzen die Position als Hinweis: in
 * einem leeren Absatz wird dieser ersetzt, sonst passend aufgeteilt.
 */
function insertBlocks(view: EditorView, nodes: PMNode[], pos?: number) {
  if (nodes.length === 0 || view.isDestroyed) return;
  const { state } = view;
  const slice = new Slice(Fragment.from(nodes), 0, 0);
  const tr =
    pos === undefined
      ? state.tr.replaceSelection(slice)
      : (() => {
          const at = Math.max(0, Math.min(pos, state.doc.content.size));
          return state.tr.replaceRange(at, at, slice);
        })();
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/**
 * Dateien nacheinander hochladen und danach gemeinsam einfuegen (Reihen-
 * folge bleibt erhalten). Der Editor bleibt waehrenddessen bedienbar;
 * fehlgeschlagene Dateien werden gesammelt gemeldet, die uebrigen
 * trotzdem eingefuegt.
 */
export async function uploadAndInsert(
  view: EditorView,
  files: File[],
  ctx: UploadContext,
  pos?: number,
): Promise<void> {
  const errors: string[] = [];
  const nodes: PMNode[] = [];
  for (const file of files) {
    try {
      const result = await uploadFile(file, ctx);
      if (view.isDestroyed) return;
      nodes.push(view.state.schema.nodeFromJSON(nodeForUpload(result)));
    } catch (e) {
      errors.push(
        `${file.name}: ${e instanceof Error ? e.message : "Upload fehlgeschlagen."}`,
      );
    }
  }
  insertBlocks(view, nodes, pos);
  if (errors.length) alert(errors.join("\n"));
}

/**
 * Dateiauswahl oeffnen, hochladen, einfuegen. `range` ist der Slash-
 * Befehl im Text, der vorher entfernt wird (auch bei Abbruch).
 */
export function pickAndUpload(
  editor: Editor,
  ctx: UploadContext,
  opts: { accept?: string; range?: Range } = {},
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (opts.accept) input.accept = opts.accept;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    let chain = editor.chain().focus();
    if (opts.range) chain = chain.deleteRange(opts.range);
    chain.run();
    if (files.length) void uploadAndInsert(editor.view, files, ctx);
  };
  input.click();
}
