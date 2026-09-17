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

/**
 * Art der Datei, wenn der Aufrufer sie schon kennt (Feld `kind` von
 * /api/upload): "image" erzwingt die strenge Bildpruefung und lehnt
 * alles andere ab, "file" speichert auch ein Bild als Anhang. Ohne
 * Angabe entscheiden die Magic Bytes — das ist der Fall fuer alles, was
 * im Dokument landet, denn dort sollen Bild und Anhang beide erlaubt
 * sein.
 */
export type UploadKind = "image" | "file";

/**
 * Nur diese Typen werden inline als Bild eingebettet (SVG bewusst
 * nicht). Abgeleitet aus lib/image-types, damit der Dateidialog
 * dieselbe Liste anbietet, die /api/upload auch annimmt — hier
 * weiterexportiert, damit die Aufrufer im Editor bei einem Import
 * bleiben.
 */
export { IMAGE_ACCEPT } from "@/lib/image-types";

/**
 * Datei an /api/upload schicken. Wirft mit der Server-Fehlermeldung
 * (z. B. "Datei zu gross (max. 50 MB)"), damit der Aufrufer sie zeigen kann.
 *
 * Exportiert, weil es mehr als einen Upload-Weg gibt: das Titelbild
 * braucht nur die fertige URL einer einzelnen Datei und hatte dafuer
 * eine zweite, eigene Fassung derselben Anfrage. Eine Fassung, damit
 * Feldnamen und Fehlerbehandlung nicht auseinanderlaufen.
 */
export async function uploadFile(
  file: File,
  ctx: UploadContext,
  kind?: UploadKind,
): Promise<UploadResult> {
  const body = new FormData();
  body.set("file", file);
  body.set("spaceId", ctx.spaceId);
  body.set("pageId", ctx.pageId);
  // Nur setzen, wenn der Aufrufer sich festlegt: ein leeres Feld liesse
  // die Route auf "file" fallen und ein Bild waere nur noch Anhang.
  if (kind) body.set("kind", kind);
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
function nodeForUpload(result: UploadResult) {
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
  onError?: (reason: unknown) => void,
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
  if (!errors.length) return;
  // Der Aufrufer meldet den Fehler, wenn er kann: `useToast` ist ein
  // React-Hook und hier, in einem reinen Modul, nicht aufrufbar. Ohne
  // `onError` bleibt nur `alert` — ein blockierender Systemdialog, aber
  // immer noch besser als ein Upload, der stillschweigend nichts tut.
  // Als Error uebergeben, weil die Handler im Editor genau daraus die
  // Meldung ziehen (`reason instanceof Error ? reason.message : …`).
  const reason = new Error(errors.join("\n"));
  if (onError) onError(reason);
  else alert(reason.message);
}

/**
 * Dateiauswahl oeffnen, hochladen, einfuegen. `range` ist der Slash-
 * Befehl im Text, der vorher entfernt wird (auch bei Abbruch).
 */
export function pickAndUpload(
  editor: Editor,
  ctx: UploadContext,
  opts: {
    accept?: string;
    range?: Range;
    /** Fehlermeldung der fehlgeschlagenen Dateien; siehe uploadAndInsert. */
    onError?: (reason: unknown) => void;
  } = {},
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (opts.accept) input.accept = opts.accept;

  // Der Slash-Befehl muss in JEDEM Fall aus dem Text verschwinden — auch
  // wenn der Dateidialog abgebrochen wird. "change" feuert dann nicht;
  // dafuer gibt es "cancel" (und als Rueckfalltuer den Fokus-Wechsel
  // zurueck ins Fenster).
  let settled = false;
  const clearRange = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener("focus", onWindowFocus);
    if (opts.range) editor.chain().focus().deleteRange(opts.range).run();
  };
  function onWindowFocus() {
    // Nach dem Schliessen des Dialogs; "change" kommt ggf. erst danach.
    setTimeout(() => {
      if (input.files && input.files.length > 0) return;
      clearRange();
    }, 300);
  }

  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    settled = true;
    window.removeEventListener("focus", onWindowFocus);
    let chain = editor.chain().focus();
    if (opts.range) chain = chain.deleteRange(opts.range);
    chain.run();
    if (files.length) {
      void uploadAndInsert(editor.view, files, ctx, undefined, opts.onError);
    }
  };
  input.addEventListener("cancel", clearRange);
  window.addEventListener("focus", onWindowFocus);
  input.click();
}
