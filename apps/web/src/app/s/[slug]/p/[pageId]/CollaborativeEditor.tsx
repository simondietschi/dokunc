"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  type Editor,
} from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { richExtensions } from "@dokunc/editor";
import type { Range } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  History,
  Trash2,
  FileText,
  AtSign,
  LayoutTemplate,
  Bell,
  BellOff,
  Star,
} from "lucide-react";
import { ExportMenu } from "@/components/editor/ExportMenu";
import { EditorToolbar } from "@/components/space/EditorToolbar";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { AttachmentView } from "@/components/editor/AttachmentView";
import { BlockHandle } from "@/components/editor/BlockHandle";
import { Outline } from "@/components/editor/Outline";
import { PageCover, PageIcon } from "@/components/editor/PageChrome";
import { ShareDialog, type ShareRow } from "./ShareDialog";
import { ToggleView } from "@/components/editor/ToggleView";
import { WordCount } from "@/components/editor/WordCount";
import { CalloutView } from "@/components/editor/CalloutView";
import { CodeBlockView } from "@/components/editor/CodeBlockView";
import { ImageView } from "@/components/editor/ImageView";
import { MermaidView } from "@/components/editor/MermaidView";
import { WikiLinkView } from "@/components/editor/WikiLinkView";
import { MentionView } from "@/components/editor/MentionView";
import { ExcalidrawView } from "@/components/editor/ExcalidrawView";
import { DrawioView } from "@/components/editor/DrawioView";
import {
  createSlashCommands,
  type PromptRequest,
} from "@/components/editor/SlashCommands";
import { createEntitySuggestion } from "@/components/editor/EntitySuggestion";
import { SelectionMenu } from "@/components/editor/SelectionMenu";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast } from "@/components/ui/Toast";
import { caretColorFor } from "@/lib/caret-color";
import { looksLikeMarkdown, markdownToHtml } from "@/lib/markdown-paste";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/cn";
import { toggleSubscriptionAction } from "./comments/actions";
import {
  renamePageAction,
  deletePageAction,
  setPageCoverAction,
  setPageIconAction,
  toggleFavoriteAction,
  toggleTemplateAction,
} from "../../actions";

/** Bildtypen, die der Server annimmt (siehe lib/uploads). */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Lädt ein Bild hoch und gibt seine URL zurück. Wirft bei Ablehnung. */
async function uploadImage(file: File, spaceId: string): Promise<string> {
  const body = new FormData();
  body.set("file", file);
  // Der Space entscheidet, wer die Datei später sehen darf.
  body.set("spaceId", spaceId);
  const res = await fetch("/api/upload", { method: "POST", body });
  if (!res.ok) throw new Error(`Upload abgelehnt (${res.status})`);
  const { url } = (await res.json()) as { url: string };
  return url;
}

/** Bilddateien aus Zwischenablage oder Drag-Nutzlast. */
function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => IMAGE_TYPES.includes(f.type));
}

/**
 * Lädt Dateien hoch und setzt sie an die gegebene Stelle.
 * Die Position wird beim Einfügen frisch begrenzt: zwischen Auswahl und
 * fertigem Upload kann sich das Dokument verändert haben.
 */
async function insertUploadedImages(
  view: EditorView,
  files: File[],
  at: number,
  spaceId: string,
  onError: () => void,
): Promise<void> {
  for (const file of files) {
    try {
      const src = await uploadImage(file, spaceId);
      const type = view.state.schema.nodes.image;
      if (!type) continue;
      const pos = Math.min(at, view.state.doc.content.size);
      view.dispatch(view.state.tr.insert(pos, type.create({ src })));
    } catch {
      onError();
    }
  }
}

/**
 * Setzt HTML an der aktuellen Auswahl ein.
 *
 * Geparst wird in einem inerten Dokument (`DOMParser`), nicht über
 * `innerHTML`: dort würden Bilder tatsächlich geladen und ein
 * `onerror` liefe los. Anschliessend filtert das ProseMirror-Schema
 * alles heraus, was der Editor nicht kennt.
 */
function insertHtmlAtSelection(view: EditorView, html: string): void {
  const parsed = new window.DOMParser().parseFromString(html, "text/html");
  const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(
    parsed.body,
    { preserveWhitespace: false },
  );
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
}

/** Markdown-Datei wählen und als echte Blöcke einfügen. */
function pickAndImportMarkdown(
  editor: Editor,
  range: Range | undefined,
  onError: () => void,
) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.markdown,text/markdown,text/plain";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (range) editor.chain().focus().deleteRange(range).run();
    if (!file) return;
    try {
      const text = await file.text();
      insertHtmlAtSelection(editor.view, markdownToHtml(text));
    } catch {
      onError();
    }
  };
  input.click();
}

/** Beliebige Datei wählen, hochladen, als Anhang einfügen. */
function pickAndUploadAttachment(
  editor: Editor,
  range: Range | undefined,
  spaceId: string,
  onError: () => void,
) {
  const input = document.createElement("input");
  input.type = "file";
  input.onchange = async () => {
    const file = input.files?.[0];
    let chain = editor.chain().focus();
    if (range) chain = chain.deleteRange(range);
    if (!file) {
      chain.run();
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("spaceId", spaceId);
    body.set("kind", "file");
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        url: string;
        name: string;
        size: number;
        contentType: string;
      };
      chain
        .setAttachment({
          url: data.url,
          name: data.name,
          size: data.size,
          mime: data.contentType,
        })
        .run();
    } catch {
      chain.run();
      onError();
    }
  };
  input.click();
}

/** Datei wählen, hochladen, als Bild einfügen. */
function pickAndUploadImage(
  editor: Editor,
  range: Range | undefined,
  spaceId: string,
  onError: () => void,
) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.onchange = async () => {
    const file = input.files?.[0];
    let chain = editor.chain().focus();
    if (range) chain = chain.deleteRange(range);
    if (!file) {
      chain.run();
      return;
    }
    try {
      const url = await uploadImage(file, spaceId);
      chain.setImage({ src: url }).run();
    } catch {
      chain.run();
      onError();
    }
  };
  input.click();
}

/**
 * Signal des Collab-Servers, dass der Stand dieser Seite ersetzt wurde
 * (Wiederherstellung einer Version). Gegenstück: apps/collab/src/server.ts.
 */
const COLLAB_RELOAD_SIGNAL = "dokunc:reload";

/**
 * Holt eine kurzlebige Eintrittskarte für den Collab-Server.
 * Wirft bei Ablehnung — der Provider behandelt das als
 * fehlgeschlagene Authentifizierung und versucht es später erneut.
 */
async function fetchCollabTicket(pageId: string): Promise<string> {
  const res = await fetch("/api/collab/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId }),
  });
  if (!res.ok) throw new Error(`Ticket abgelehnt (${res.status})`);
  const { ticket } = (await res.json()) as { ticket: string };
  return ticket;
}

type Peer = { name: string; color: string };

export function CollaborativeEditor({
  slug,
  spaceId,
  pageId,
  title,
  collabUrl,
  editable,
  canManage,
  userId,
  userName,
  pdfEnabled,
  updatedAt,
  lastEditorName,
  commentThreadIds,
  icon,
  coverUrl,
  isTemplate,
  isSubscribed,
  isFavorite,
  shares,
}: {
  slug: string;
  spaceId: string;
  pageId: string;
  title: string;
  collabUrl: string;
  editable: boolean;
  canManage: boolean;
  userId: string;
  userName: string;
  pdfEnabled: boolean;
  updatedAt: string;
  lastEditorName: string | null;
  /** IDs bestehender Kommentar-Threads, für den Waisen-Aufräumlauf. */
  commentThreadIds: string[];
  icon: string | null;
  coverUrl: string | null;
  isTemplate: boolean;
  /** Folgt diese Person der Seite? */
  isSubscribed: boolean;
  isFavorite: boolean;
  shares: ShareRow[];
}) {
  const ydoc = useMemo(() => new Y.Doc(), [pageId]);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "offline"
  >("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [titleValue, setTitleValue] = useState(title);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const lastSavedTitle = useRef(title);
  const titleRef = useRef<HTMLInputElement>(null);
  const savingTitle = useRef<string | null>(null);
  const sweptRef = useRef(false);
  const { toast } = useToast();

  const openPrompt = useCallback((request: PromptRequest) => {
    setPrompt(request);
  }, []);

  // Symbol und Titelbild lokal spiegeln: der Server-Roundtrip soll die
  // Anzeige nicht ausbremsen, die Action bleibt die Wahrheit.
  const [iconValue, setIconValue] = useState(icon);
  const [coverValue, setCoverValue] = useState(coverUrl);

  const onUploadError = useCallback(() => {
    toast({
      title: "Upload fehlgeschlagen",
      description: "Erlaubt sind PNG, JPG, GIF und WebP bis 10 MB.",
      variant: "error",
    });
  }, [toast]);

  /**
   * Titel speichern. Der Merker wird erst NACH erfolgreicher Action
   * gesetzt: vorher markierte ein fehlgeschlagener oder verworfener
   * Aufruf den Titel als gespeichert, und ein zweiter Versuch lief in
   * den Frühausstieg. Der Titel stand dann nur noch lokal im Feld.
   */
  async function saveTitle() {
    // Der Wert kommt aus dem Feld, nicht aus dem Zustand: `onBlur` kann
    // feuern, bevor React die letzte Eingabe gerendert hat, und würde
    // dann den alten Titel speichern (oder gar nichts, weil er dem
    // Merker gleicht).
    const next = titleRef.current?.value ?? titleValue;
    if (!editable || next === lastSavedTitle.current) return;
    if (savingTitle.current === next) return; // schon unterwegs
    savingTitle.current = next;
    try {
      const fd = new FormData();
      fd.set("slug", slug);
      fd.set("pageId", pageId);
      fd.set("title", next);
      await renamePageAction(fd);
      lastSavedTitle.current = next;
    } catch {
      toast({
        title: "Titel konnte nicht gespeichert werden",
        description: "Die Änderung wurde nicht übernommen.",
        variant: "error",
      });
    } finally {
      savingTitle.current = null;
    }
  }

  const saveIcon = useCallback(
    async (next: string) => {
      const previous = iconValue;
      setIconValue(next || null);
      try {
        const fd = new FormData();
        fd.set("slug", slug);
        fd.set("pageId", pageId);
        fd.set("icon", next);
        await setPageIconAction(fd);
      } catch {
        setIconValue(previous);
        toast({ title: "Symbol nicht gespeichert", variant: "error" });
      }
    },
    [iconValue, pageId, slug, toast],
  );

  const saveCover = useCallback(
    async (next: string) => {
      const previous = coverValue;
      setCoverValue(next || null);
      try {
        const fd = new FormData();
        fd.set("slug", slug);
        fd.set("pageId", pageId);
        fd.set("coverUrl", next);
        await setPageCoverAction(fd);
      } catch {
        setCoverValue(previous);
        toast({ title: "Titelbild nicht gespeichert", variant: "error" });
      }
    },
    [coverValue, pageId, slug, toast],
  );

  const pickCover = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        void saveCover(await uploadImage(file, spaceId));
      } catch {
        onUploadError();
      }
    };
    input.click();
  }, [onUploadError, saveCover, spaceId]);

  /**
   * Lokaler Puffer.
   *
   * Ohne ihn lebte das Yjs-Dokument nur im Speicher des Tabs: wer bei
   * Netzausfall weiterschrieb und dann neu lud, verlor alles. Der
   * Puffer wird beim Wiederherstellen einer Version geleert, sonst
   * mischte der Tab beim Reconnect seinen alten Stand wieder ein.
   */
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    const persistence = new IndexeddbPersistence(`dokunc:${pageId}`, ydoc);
    persistenceRef.current = persistence;
    return () => {
      persistenceRef.current = null;
      void persistence.destroy();
    };
  }, [pageId, ydoc]);

  // Netzstatus des Browsers: "Verbinde…" ist bei gezogenem Kabel eine
  // Beschönigung, die niemandem hilft.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  /**
   * Der Server hat den Stand dieser Seite ersetzt (Wiederherstellung).
   * Das Aufräumen läuft absichtlich in einem Effekt und nicht direkt im
   * Provider-Callback: dort liegt es im Rumpf eines useMemo, und ein
   * Zugriff auf eine Ref gehört nicht in den Renderdurchlauf.
   */
  const [reloadRequested, setReloadRequested] = useState(false);
  useEffect(() => {
    if (!reloadRequested) return;
    // Der lokale Puffer muss mit weg, sonst mischt dieser Tab beim
    // nächsten Verbinden seinen alten Stand wieder ein.
    void (persistenceRef.current?.clearData() ?? Promise.resolve()).finally(
      () => window.location.reload(),
    );
  }, [reloadRequested]);

  const provider = useMemo(
    () =>
      new HocuspocusProvider({
        url: collabUrl,
        name: pageId,
        document: ydoc,
        // Vor JEDEM Verbindungsversuch ein frisches Ticket holen. Die
        // Sitzung selbst bleibt im httpOnly-Cookie; ins ausgelieferte
        // HTML gelangt nichts Wiederverwendbares.
        token: () => fetchCollabTicket(pageId),
        // "Live" erst nach erfolgreicher Server-Authentifizierung —
        // Socket-Open allein heißt noch nicht, dass wir schreiben dürfen.
        onAuthenticated: () => setStatus("connected"),
        onAuthenticationFailed: () => setStatus("offline"),
        onStatus: ({ status }) => {
          if (status !== "connected") setStatus("connecting");
        },
        onStateless: ({ payload }) => {
          // Neu laden ist hier die ehrliche Antwort: ein blosser
          // Reconnect würde den alten Yjs-Stand aus diesem Tab wieder
          // einmischen und die Wiederherstellung zunichtemachen.
          if (payload === COLLAB_RELOAD_SIGNAL) setReloadRequested(true);
        },
      }),
    [collabUrl, pageId, ydoc],
  );

  const color = useMemo(() => caretColorFor(userId), [userId]);

  const slash = useMemo(
    () =>
      createSlashCommands({
        onImage: (e, r) => pickAndUploadImage(e, r, spaceId, onUploadError),
        onMarkdownImport: (e, r) =>
          pickAndImportMarkdown(e, r, () =>
            toast({
              title: "Import fehlgeschlagen",
              description: "Die Datei liess sich nicht lesen.",
              variant: "error",
            }),
          ),
        onAttachment: (e, r) =>
          pickAndUploadAttachment(e, r, spaceId, () =>
            toast({
              title: "Anhang fehlgeschlagen",
              description: "Dateien bis 25 MB werden angenommen.",
              variant: "error",
            }),
          ),
        onPrompt: openPrompt,
      }),
    [onUploadError, openPrompt, spaceId, toast],
  );

  const wikiLinkSuggest = useMemo(
    () =>
      createEntitySuggestion({
        name: "wikiLinkSuggestion",
        char: "[[",
        spaceId,
        kind: "pages",
        nodeType: "wikiLink",
        icon: FileText,
        subtitle: "Seite verlinken",
      }),
    [spaceId],
  );

  const mentionSuggest = useMemo(
    () =>
      createEntitySuggestion({
        name: "mentionSuggestion",
        char: "@",
        spaceId,
        kind: "members",
        nodeType: "mention",
        icon: AtSign,
        subtitle: "Person erwähnen",
      }),
    [spaceId],
  );

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      ...richExtensions({
        attachment: () => ReactNodeViewRenderer(AttachmentView),
        callout: () => ReactNodeViewRenderer(CalloutView),
        toggle: () => ReactNodeViewRenderer(ToggleView),
        codeBlock: () => ReactNodeViewRenderer(CodeBlockView),
        image: () => ReactNodeViewRenderer(ImageView),
        mermaid: () => ReactNodeViewRenderer(MermaidView),
        wikiLink: () => ReactNodeViewRenderer(WikiLinkView),
        mention: () => ReactNodeViewRenderer(MentionView),
        excalidraw: () => ReactNodeViewRenderer(ExcalidrawView),
        drawio: () => ReactNodeViewRenderer(DrawioView),
      }),
      Placeholder.configure({
        placeholder:
          'Schreib etwas — "/" für Befehle, "[[" für Links, "@" für Mentions…',
        includeChildren: true,
      }),
      Collaboration.configure({ document: ydoc, field: "default" }),
      CollaborationCaret.configure({
        provider,
        user: { name: userName, color },
      }),
      slash,
      wikiLinkSuggest,
      mentionSuggest,
    ],
    editorProps: {
      attributes: { class: "mx-auto max-w-[760px] px-6 pb-40" },
      // Klick auf eine kommentierte Stelle hebt den zugehörigen Thread
      // hervor. false: der Klick wird nicht geschluckt, der Cursor darf
      // trotzdem gesetzt werden.
      handleClick(view, pos) {
        const mark = view.state.doc
          .resolve(pos)
          .marks()
          .find((m) => m.type.name === "commentMark");
        const id = mark?.attrs.commentId;
        if (typeof id !== "string" || !id) return false;
        window.dispatchEvent(
          new CustomEvent("dokunc:focus-comment-thread", { detail: { id } }),
        );
        return false;
      },
      handlePaste(view, event) {
        if (!editable) return false;

        // Bild aus der Zwischenablage (Screenshot) direkt hochladen.
        const files = imageFilesFrom(event.clipboardData);
        if (files.length > 0) {
          event.preventDefault();
          void insertUploadedImages(
            view,
            files,
            view.state.selection.from,
            spaceId,
            onUploadError,
          );
          return true;
        }

        // Markdown als echte Blöcke einfügen. Nur wenn die
        // Zwischenablage kein HTML mitbringt: dann kommt der Inhalt aus
        // einer formatierten Quelle und ProseMirror kann ihn selbst.
        const html = event.clipboardData?.getData("text/html");
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!html && looksLikeMarkdown(text)) {
          event.preventDefault();
          insertHtmlAtSelection(view, markdownToHtml(text));
          return true;
        }
        return false;
      },
      // Bild aus dem Dateimanager an die Stelle ziehen, auf die man zeigt.
      handleDrop(view, event, _slice, moved) {
        // `moved` heisst: der Block wird innerhalb des Dokuments
        // verschoben — das darf ProseMirror selbst erledigen.
        if (moved || !editable) return false;
        const files = imageFilesFrom(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const at =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          view.state.selection.from;
        void insertUploadedImages(view, files, at, spaceId, onUploadError);
        return true;
      },
    },
  });

  // CommentsPanel bittet darum, eine Kommentar-Markierung zu entfernen
  // (Thread verworfen oder aufgelöst).
  useEffect(() => {
    const onRemove = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      if (!editor) return;
      const { state } = editor;
      const markType = state.schema.marks.commentMark;
      if (!markType) return;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        for (const mark of node.marks) {
          if (mark.type === markType && mark.attrs.commentId === id) {
            tr.removeMark(pos, pos + node.nodeSize, markType);
          }
        }
      });
      if (tr.docChanged) editor.view.dispatch(tr);
    };
    window.addEventListener("dokunc:remove-comment-mark", onRemove);
    return () =>
      window.removeEventListener("dokunc:remove-comment-mark", onRemove);
  });

  // Verwaiste Kommentar-Markierungen aufräumen: ein abgebrochener Entwurf
  // (Navigation, Reload, Absturz) setzt den Mark bereits im Yjs-Dokument,
  // bevor der Thread in der DB existiert. Einmal nach dem Sync durchgehen
  // und alle Marks ohne zugehörigen Thread entfernen.
  useEffect(() => {
    if (!editor || !editable || sweptRef.current) return;
    const valid = new Set(commentThreadIds);

    const sweep = () => {
      // Genau einmal pro geöffneter Seite, auch wenn der Effekt durch neue
      // Prop-Referenzen erneut läuft.
      if (sweptRef.current || editor.isDestroyed) return;
      sweptRef.current = true;
      const { state } = editor;
      const markType = state.schema.marks.commentMark;
      if (!markType) return;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        for (const mark of node.marks) {
          if (
            mark.type === markType &&
            !valid.has(String(mark.attrs.commentId))
          ) {
            tr.removeMark(pos, pos + node.nodeSize, markType);
          }
        }
      });
      if (tr.docChanged) editor.view.dispatch(tr);
    };

    if (provider.isSynced) {
      sweep();
      return;
    }
    provider.on("synced", sweep);
    return () => {
      provider.off("synced", sweep);
    };
  }, [editor, editable, provider, commentThreadIds]);

  // Vom CommentsPanel angestossen: zur markierten Textstelle scrollen.
  useEffect(() => {
    const onScrollTo = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      const el = document.querySelector(`[data-comment-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("dk-comment-anchor--active");
      window.setTimeout(
        () => el.classList.remove("dk-comment-anchor--active"),
        1600,
      );
    };
    window.addEventListener("dokunc:scroll-to-comment-mark", onScrollTo);
    return () =>
      window.removeEventListener("dokunc:scroll-to-comment-mark", onScrollTo);
  }, []);

  useEffect(() => {
    const aw = provider.awareness;
    if (!aw) return;
    const sync = () => {
      // Nach clientID gruppieren und den eigenen Zustand auslassen: sonst
      // sieht man sich selbst als zweite Person im Peer-Stack.
      const seen = new Map<number, Peer>();
      aw.getStates().forEach((s, clientId) => {
        if (clientId === aw.clientID) return;
        const u = (s as { user?: Peer }).user;
        if (u?.name) seen.set(clientId, u);
      });
      setPeers([...seen.values()]);
    };
    aw.on("change", sync);
    sync();
    return () => aw.off("change", sync);
  }, [provider]);

  useEffect(
    () => () => {
      provider.destroy();
      ydoc.destroy();
    },
    [provider, ydoc],
  );

  // Ohne Netz ist "Verbinde…" irreführend; das Gerät versucht es gar
  // nicht erst. Der lokale Puffer trägt in dieser Zeit weiter.
  const effectiveStatus =
    status === "connected" ? "connected" : online ? status : "offline";
  const dot =
    effectiveStatus === "connected"
      ? "bg-emerald-500"
      : effectiveStatus === "offline"
        ? "bg-danger"
        : "bg-amber-500";
  const statusText =
    effectiveStatus === "connected"
      ? "Live"
      : effectiveStatus === "offline"
        ? "Offline"
        : "Verbinde…";
  const statusTitle =
    effectiveStatus === "offline"
      ? "Ohne Verbindung. Änderungen werden auf diesem Gerät gesichert und später übertragen."
      : undefined;

  return (
    <div>
      {/* Sticky Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[820px] items-center justify-between px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              // Statuswechsel werden Screenreadern angesagt, aber ohne die
              // laufende Ausgabe zu unterbrechen.
              role="status"
              aria-live="polite"
              title={statusTitle}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-muted"
            >
              <span
                aria-hidden="true"
                className={cn("h-1.5 w-1.5 rounded-full", dot)}
              />
              {statusText}
            </span>
            <PeerStack peers={peers} />
            <WordCount editor={editor} />
            <LastEdited at={updatedAt} by={lastEditorName} />
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={`/s/${slug}/p/${pageId}/history`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              <History className="h-4 w-4" />
              Verlauf
            </Link>
            <ExportMenu pageId={pageId} pdfEnabled={pdfEnabled} />
            {canManage && (
              <ShareDialog slug={slug} pageId={pageId} shares={shares} />
            )}
            <form action={toggleFavoriteAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="pageId" value={pageId} />
              <button
                title={
                  isFavorite
                    ? "Aus den Favoriten entfernen"
                    : "Zu den Favoriten"
                }
                aria-pressed={isFavorite}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-subtle",
                  isFavorite ? "text-amber-500" : "text-muted hover:text-ink",
                )}
              >
                <Star
                  className={cn("h-4 w-4", isFavorite && "fill-current")}
                />
              </button>
            </form>
            <form action={toggleSubscriptionAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="pageId" value={pageId} />
              <button
                title={
                  isSubscribed
                    ? "Dieser Seite nicht mehr folgen"
                    : "Dieser Seite folgen"
                }
                aria-pressed={isSubscribed}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-subtle",
                  isSubscribed ? "text-accent" : "text-muted hover:text-ink",
                )}
              >
                {isSubscribed ? (
                  <Bell className="h-4 w-4" />
                ) : (
                  <BellOff className="h-4 w-4" />
                )}
              </button>
            </form>
            {canManage && (
              <form action={toggleTemplateAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="pageId" value={pageId} />
                <button
                  title={
                    isTemplate
                      ? "Vorlagen-Markierung entfernen"
                      : "Als Vorlage markieren"
                  }
                  aria-pressed={isTemplate}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-subtle",
                    isTemplate ? "text-accent" : "text-muted hover:text-ink",
                  )}
                >
                  <LayoutTemplate className="h-4 w-4" />
                </button>
              </form>
            )}
            {canManage && (
              <form action={deletePageAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="pageId" value={pageId} />
                <ConfirmButton
                  message="Diese Seite und alle Unterseiten in den Papierkorb verschieben?"
                  title="Seite löschen"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </ConfirmButton>
              </form>
            )}
          </div>
        </div>
      </header>

      <PageCover
        coverUrl={coverValue}
        editable={editable}
        onPick={pickCover}
        onRemove={() => void saveCover("")}
      />

      {/* Title — kontrolliert + explizites Speichern nur bei Änderung.
          (Kein <form action>: React 19 resettet unkontrollierte Felder
          nach Server-Actions, was Eingaben klobbern kann.) */}
      <div
        className={cn(
          "mx-auto max-w-[760px] px-6",
          coverValue ? "pt-5" : "pt-12",
        )}
      >
        <div className="mb-1 flex items-center gap-1">
          <PageIcon
            icon={iconValue}
            editable={editable}
            onChange={(next) => void saveIcon(next)}
          />
          {editable && !coverValue && (
            <PageCover
              coverUrl={null}
              editable
              onPick={pickCover}
              onRemove={() => void saveCover("")}
            />
          )}
        </div>
        <input
          ref={titleRef}
          name="title"
          aria-label="Seitentitel"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          readOnly={!editable}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Ohne Titel"
          className="w-full bg-transparent text-[2.5rem] font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-faint"
        />
      </div>

      <Outline editor={editor} />
      {editable && <BlockHandle editor={editor} />}

      {/* Toolbar */}
      {editable && (
        <div className="sticky top-14 z-10 mx-auto mt-4 max-w-[760px] px-6">
          <EditorToolbar editor={editor} onPrompt={openPrompt} />
        </div>
      )}

      {/* Canvas */}
      <div className="mt-6 animate-[fade-in_0.4s_ease]">
        <EditorContent editor={editor} />
      </div>

      {/* Formatieren direkt an der Auswahl. */}
      {editable && editor && (
        <SelectionMenu editor={editor} onPrompt={openPrompt} />
      )}

      {/* Ersetzt window.prompt für Link- und Video-URLs. */}
      <PromptDialog
        open={prompt !== null}
        title={prompt?.title ?? ""}
        description={prompt?.description}
        label={prompt?.label ?? ""}
        placeholder={prompt?.placeholder}
        submitLabel={prompt?.submitLabel}
        onSubmit={(value) => prompt?.onSubmit(value)}
        onClose={() => setPrompt(null)}
      />
    </div>
  );
}

/**
 * "Zuletzt bearbeitet" im Seitenkopf. Bewusst erst nach dem Mount
 * gerendert: relative Zeit und lokale Zeitzone hängen vom Client ab und
 * würden serverseitig eine andere Zeichenkette ergeben. Eine solche
 * Hydration-Diskrepanz lässt React den Teilbaum neu aufbauen, wodurch
 * Handler (u. a. das Speichern des Titels) kurzzeitig verloren gehen.
 */
function LastEdited({ at, by }: { at: string; by: string | null }) {
  const [label, setLabel] = useState<{ text: string; title: string } | null>(
    null,
  );

  useEffect(() => {
    const date = new Date(at);
    const absolute = date.toLocaleString("de-CH", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    setLabel({
      text: `Zuletzt bearbeitet ${relativeTime(date)}${by ? ` von ${by}` : ""}`,
      title: by ? `${absolute} von ${by}` : absolute,
    });
  }, [at, by]);

  if (!label) return null;
  return (
    <span
      title={label.title}
      className="hidden truncate text-[12px] text-faint sm:block"
    >
      {label.text}
    </span>
  );
}

function PeerStack({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) return null;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {peers.slice(0, 5).map((p, i) => (
          <span
            key={i}
            title={p.name}
            style={{ background: p.color }}
            className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold text-white ring-2 ring-canvas"
          >
            {p.name.trim()[0]?.toUpperCase() ?? "?"}
          </span>
        ))}
      </div>
      {peers.length > 5 && (
        <span className="ml-2 text-xs text-faint">
          +{peers.length - 5}
        </span>
      )}
    </div>
  );
}
