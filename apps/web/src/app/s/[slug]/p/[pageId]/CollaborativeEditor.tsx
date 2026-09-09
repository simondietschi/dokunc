"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  type Editor,
} from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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
  FileText,
  AtSign,
  Bell,
  BellOff,
} from "lucide-react";
import { ExportMenu } from "@/components/editor/ExportMenu";
import { TableOfContents } from "@/components/editor/TableOfContents";
import { EditorToolbar } from "@/components/space/EditorToolbar";
import { AttachmentView } from "@/components/editor/AttachmentView";
import { BlockHandle } from "@/components/editor/BlockHandle";
import { Outline } from "@/components/editor/Outline";
import { PageCover, PageIcon } from "@/components/editor/PageChrome";
import { ShareDialog, type ShareRow } from "./ShareDialog";
import {
  AccessDialog,
  type AccessCandidate,
  type GrantRow,
} from "./AccessDialog";
import { ToggleView } from "@/components/editor/ToggleView";
import { WordCount } from "@/components/editor/WordCount";
import { PageActions } from "@/components/space/PageActions";
import { Breadcrumbs, type Crumb } from "@/components/space/Breadcrumbs";
import {
  MovePageDialog,
  MovePageMenuItem,
} from "@/components/space/MovePageDialog";
import { FavoriteButton } from "@/components/space/FavoriteButton";
import { PageMenuTemplates } from "@/components/space/PageMenuTemplates";
import { CalloutView } from "@/components/editor/CalloutView";
import { CodeBlockView } from "@/components/editor/CodeBlockView";
import { ImageView } from "@/components/editor/ImageView";
import { MermaidView } from "@/components/editor/MermaidView";
import { WikiLinkView } from "@/components/editor/WikiLinkView";
import { MentionView } from "@/components/editor/MentionView";
import { ExcalidrawView } from "@/components/editor/ExcalidrawView";
import { DrawioView } from "@/components/editor/DrawioView";
import {
  IMAGE_ACCEPT,
  pickAndUpload,
  uploadAndInsert,
} from "@/components/editor/upload";
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
  setPageCoverAction,
  setPageIconAction,
} from "../../actions";

/**
 * Titelbild hochladen. Der Rest der Dateiwege laeuft ueber
 * `components/editor/upload` (mehrere Dateien, Fehler pro Datei); das
 * Cover braucht nur die fertige URL einer einzelnen Datei.
 */
async function uploadCoverImage(
  file: File,
  spaceId: string,
  pageId: string,
): Promise<string> {
  const body = new FormData();
  body.set("file", file);
  // Space und Seite entscheiden, wer die Datei spaeter sehen darf.
  body.set("spaceId", spaceId);
  body.set("pageId", pageId);
  body.set("kind", "image");
  const res = await fetch("/api/upload", { method: "POST", body });
  if (!res.ok) throw new Error(`Upload abgelehnt (${res.status})`);
  const { url } = (await res.json()) as { url: string };
  return url;
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
type Conn = { ydoc: Y.Doc; provider: HocuspocusProvider };

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
  isTemplate = false,
  isSubscribed,
  isFavorite,
  shares,
  access,
  breadcrumbs,
  hasChildren = false,
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
  /** Seite ist eine Vorlage (Badge + Menüeintrag "Seite daraus erstellen"). */
  isTemplate?: boolean;
  /** Folgt diese Person der Seite? */
  isSubscribed: boolean;
  isFavorite: boolean;
  shares: ShareRow[];
  /** Schutzstatus und Freigabeliste dieser Seite. */
  access: {
    isRestricted: boolean;
    inheritedFrom: string | null;
    grants: GrantRow[];
    people: AccessCandidate[];
    groups: AccessCandidate[];
  };
  /** Space-Name und Vorfahren (Wurzel zuerst) fuer die Brotkrumen. */
  breadcrumbs: { spaceName: string; ancestors: Crumb[] };
  /** Für "Duplizieren": Option "Unterseiten mitkopieren" nur bei Bedarf. */
  hasChildren?: boolean;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  // "connected" heisst hier: authentifiziert UND erstmalig synchronisiert.
  // Vor dem Sync ist das Yjs-Dokument noch leer bzw. unvollstaendig —
  // wer da schon tippt, schreibt in ein Dokument, dessen Inhalt gleich
  // erst eintrifft, und der Text landet an der falschen Stelle.
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

  /** Sidebar sofort nachziehen; der Server liefert den Titel spaeter
   * ueber revalidatePath ohnehin nach. */
  const announceTitle = useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent("dokunc:page-renamed", {
          detail: { pageId, title: value || "Untitled" },
        }),
      );
    },
    [pageId],
  );

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
    announceTitle(next);
    try {
      const fd = new FormData();
      fd.set("slug", slug);
      fd.set("pageId", pageId);
      fd.set("title", next);
      await renamePageAction(fd);
      lastSavedTitle.current = next;
    } catch {
      // Der Baum hat den neuen Titel schon; ohne das Zuruecknehmen stuende
      // dort ein Titel, den niemand gespeichert hat.
      announceTitle(lastSavedTitle.current);
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
    input.accept = IMAGE_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        void saveCover(await uploadCoverImage(file, spaceId, pageId));
      } catch {
        onUploadError();
      }
    };
    input.click();
  }, [onUploadError, pageId, saveCover, spaceId]);

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

  // Y.Doc und Provider erst im Effekt erzeugen, nicht im Render: ein
  // memoisierter Provider wuerde beim StrictMode-Doppelmount im Cleanup
  // zerstoert und danach tot weiterverwendet (keine Updates mehr). Der
  // Effekt legt bei jedem (Re-)Mount eine frische Verbindung an.
  const [conn, setConn] = useState<Conn | null>(null);
  useEffect(() => {
    const ydoc = new Y.Doc();
    setStatus("connecting");
    /**
     * Lokaler Puffer. Ohne ihn lebte das Yjs-Dokument nur im Speicher des
     * Tabs: wer bei Netzausfall weiterschrieb und dann neu lud, verlor
     * alles.
     */
    const persistence =
      typeof indexedDB === "undefined"
        ? null
        : new IndexeddbPersistence(`dokunc:${pageId}`, ydoc);
    // Die Status-Callbacks gehoeren in den Konstruktor: der Provider
    // verbindet sofort, ein spaeter registrierter Listener koennte das
    // "authenticated"-Ereignis verpassen. "Live" erst nach erfolgreicher
    // Server-Authentifizierung: Socket-Open allein heisst noch nicht,
    // dass wir schreiben duerfen.
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: pageId,
      document: ydoc,
      // Vor JEDEM Verbindungsversuch ein frisches Ticket holen. Die
      // Sitzung selbst bleibt im httpOnly-Cookie; ins ausgelieferte
      // HTML gelangt nichts Wiederverwendbares.
      token: () => fetchCollabTicket(pageId),
      // Erst der abgeschlossene Erst-Sync macht das Dokument bedienbar
      // (onAuthenticated allein kommt vor den Inhalten).
      onSynced: () => setStatus("connected"),
      onAuthenticationFailed: () => setStatus("offline"),
      onStatus: ({ status }) => {
        if (status !== "connected") setStatus("connecting");
      },
      onDisconnect: () => setStatus("connecting"),
    });
    setConn({ ydoc, provider });
    return () => {
      setConn(null);
      provider.destroy();
      void persistence?.destroy();
      ydoc.destroy();
    };
  }, [collabUrl, pageId]);

  const color = useMemo(() => caretColorFor(userId), [userId]);

  const slash = useMemo(
    () =>
      createSlashCommands({
        onImage: (e, r) =>
          pickAndUpload(
            e,
            { spaceId, pageId },
            { accept: IMAGE_ACCEPT, range: r },
          ),
        onMarkdownImport: (e, r) =>
          pickAndImportMarkdown(e, r, () =>
            toast({
              title: "Import fehlgeschlagen",
              description: "Die Datei liess sich nicht lesen.",
              variant: "error",
            }),
          ),
        onAttachment: (e, r) => pickAndUpload(e, { spaceId, pageId }, { range: r }),
        onPrompt: openPrompt,
      }),
    [openPrompt, pageId, spaceId, toast],
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

  const editor = useEditor(
    {
    // Vor dem Erst-Sync ist der Editor nur Platzhalter: nicht editierbar
    // (das Yjs-Dokument ist noch leer), ohne Collaboration-Extensions.
    editable: editable && !!conn && status === "connected",
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
      LinkClick,
      Placeholder.configure({
        placeholder:
          'Schreib etwas — "/" für Befehle, "[[" für Links, "@" für Mentions…',
        includeChildren: true,
      }),
      ...(conn
        ? [
            Collaboration.configure({ document: conn.ydoc, field: "default" }),
            CollaborationCaret.configure({
              provider: conn.provider,
              user: { name: userName, color },
            }),
          ]
        : []),
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
      // Dateien per Einfuegen: hochladen, dann als Bild oder Anhang
      // einfuegen (asynchron, Editor bleibt bedienbar).
      handlePaste(view, event) {
        if (!view.editable) return false;

        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          void uploadAndInsert(view, files, { spaceId, pageId });
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
      // Datei aus dem Dateimanager an die Stelle ziehen, auf die man zeigt.
      handleDrop(view, event, _slice, moved) {
        // `moved` heisst: der Block wird innerhalb des Dokuments
        // verschoben — das darf ProseMirror selbst erledigen.
        if (moved || !view.editable) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        void uploadAndInsert(view, files, { spaceId, pageId }, pos);
        return true;
      },
    },
    },
    [conn],
  );

  // `editable` steckt in den useEditor-Optionen und wird nur beim
  // Erzeugen gelesen — der Sync-Status aendert sich aber danach. Also
  // nachziehen, statt den Editor dafuer neu aufzubauen.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable && !!conn && status === "connected", false);
  }, [editor, editable, conn, status]);

  // CommentsPanel bittet darum, eine Kommentar-Markierung zu entfernen
  // (Thread verworfen oder aufgelöst).
  useEffect(() => {
    if (!editor) return;
    const onRemove = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      if (editor.isDestroyed) return;
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
  }, [editor]);

  // Verwaiste Kommentar-Markierungen aufräumen: ein abgebrochener Entwurf
  // (Navigation, Reload, Absturz) setzt den Mark bereits im Yjs-Dokument,
  // bevor der Thread in der DB existiert. Einmal nach dem Sync durchgehen
  // und alle Marks ohne zugehörigen Thread entfernen.
  useEffect(() => {
    const provider = conn?.provider;
    if (!editor || !editable || !provider || sweptRef.current) return;
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
  }, [editor, editable, conn, commentThreadIds]);

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
    const aw = conn?.provider.awareness;
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
  }, [conn]);

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
            {isTemplate && (
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">
                Vorlage
              </span>
            )}
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
            {canManage && (
              <>
                <ShareDialog slug={slug} pageId={pageId} shares={shares} />
                <AccessDialog
                  slug={slug}
                  pageId={pageId}
                  isRestricted={access.isRestricted}
                  inheritedFrom={access.inheritedFrom}
                  grants={access.grants}
                  people={access.people}
                  groups={access.groups}
                />
              </>
            )}
            {!isTemplate && (
              <FavoriteButton
                slug={slug}
                pageId={pageId}
                isFavorite={isFavorite}
              />
            )}
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
            <ExportMenu pageId={pageId} pdfEnabled={pdfEnabled} />
            <PageActions slug={slug} pageId={pageId} canManage={canManage}>
              {canManage && (
                <>
                  {!isTemplate && (
                    <MovePageMenuItem onOpen={() => setMoveOpen(true)} />
                  )}
                  <PageMenuTemplates
                    slug={slug}
                    pageId={pageId}
                    isTemplate={isTemplate}
                    hasChildren={hasChildren}
                  />
                </>
              )}
            </PageActions>
          </div>
        </div>
      </header>
      {moveOpen && (
        <MovePageDialog
          slug={slug}
          spaceId={spaceId}
          pageId={pageId}
          onClose={() => setMoveOpen(false)}
        />
      )}

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
        <Breadcrumbs
          slug={slug}
          spaceName={breadcrumbs.spaceName}
          ancestors={breadcrumbs.ancestors}
          current={titleValue}
        />
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
            // Enter/Pfeil nach unten: in den Text springen (wie in Notion).
            if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              e.currentTarget.blur();
              editor?.commands.focus("start");
            }
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
        <TableOfContents editor={editor}>
          <EditorContent editor={editor} />
        </TableOfContents>
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
