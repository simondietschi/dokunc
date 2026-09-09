"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Pencil,
  CheckCircle2,
  RotateCcw,
  Trash2,
  CornerDownRight,
  ChevronDown,
  Crosshair,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { useToast } from "@/components/ui/Toast";
import {
  createThreadAction,
  editCommentAction,
  replyAction,
  resolveThreadAction,
  deleteCommentAction,
} from "./actions";

type Author = { id: string; name: string } | null;
export type ThreadData = {
  id: string;
  body: string;
  anchorText: string | null;
  /** Wurde der Text nach dem Anlegen geändert? */
  edited: boolean;
  resolved: boolean;
  createdAt: string;
  author: Author;
  replies: {
    id: string;
    body: string;
    createdAt: string;
    edited: boolean;
    author: Author;
  }[];
};

/** Wird vom Editor-Toolbar-Button gefeuert (Text markiert -> Thread). */
export type NewThreadEvent = CustomEvent<{
  id: string;
  anchorText: string;
}>;

/** Markierung im Dokument entfernen (Thread verworfen, aufgelöst, gelöscht). */
function removeMark(id: string) {
  window.dispatchEvent(
    new CustomEvent("dokunc:remove-comment-mark", { detail: { id } }),
  );
}

/** Im Dokument zur markierten Textstelle springen. */
function scrollToMark(id: string) {
  window.dispatchEvent(
    new CustomEvent("dokunc:scroll-to-comment-mark", { detail: { id } }),
  );
}

export function CommentsPanel({
  slug,
  pageId,
  currentUserId,
  canComment,
  canAnnotate,
  threads,
}: {
  slug: string;
  pageId: string;
  currentUserId: string;
  canComment: boolean;
  /** Darf diese Person Markierungen im Dokument setzen? */
  canAnnotate: boolean;
  threads: ThreadData[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<{
    id: string;
    anchorText: string;
  } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const draftRef = useRef<HTMLDivElement>(null);

  // Editor-Toolbar meldet: neue Kommentar-Markierung angelegt.
  useEffect(() => {
    const onNew = (e: Event) => {
      const { id, anchorText } = (e as NewThreadEvent).detail;
      setDraft({ id, anchorText });
      setTimeout(
        () => draftRef.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    };
    window.addEventListener("dokunc:new-comment-thread", onNew);
    return () =>
      window.removeEventListener("dokunc:new-comment-thread", onNew);
  }, []);

  // Klick auf eine markierte Textstelle im Editor: Thread hervorheben.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      // Aufgelöste Threads sind eingeklappt: aufklappen, sonst zeigt der
      // Sprung ins Leere.
      if (threads.some((t) => t.id === id && t.resolved)) setShowResolved(true);
      setActiveId(id);
      // Nach dem Aufklappen rendern lassen, dann scrollen.
      requestAnimationFrame(() => {
        document
          .getElementById(`comment-thread-${id}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    };
    window.addEventListener("dokunc:focus-comment-thread", onFocus);
    return () =>
      window.removeEventListener("dokunc:focus-comment-thread", onFocus);
  }, [threads]);

  const cancelDraft = useCallback(() => {
    // Ohne das bliebe eine verwaiste gelbe Markierung im Text stehen.
    if (draft) removeMark(draft.id);
    setDraft(null);
  }, [draft]);

  // Navigation oder Reload mit offenem Entwurf hinterlassen ebenfalls eine
  // verwaiste Markierung. Das lässt sich hier nicht zuverlässig abfangen
  // (Panel und Editor werden gleichzeitig abgebaut), deshalb räumt der
  // Editor beim Laden alle Marks ohne zugehörigen Thread auf.

  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);

  // Leerer Zustand: bisher rendert das Panel gar nichts, es gab also
  // keinen sichtbaren Einstieg in die Kommentarfunktion.
  if (!draft && threads.length === 0 && !canComment) return null;

  return (
    <section className="mt-6 border-t border-line pt-6">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        <MessageSquare className="h-3.5 w-3.5" />
        Kommentare ({open.length})
      </h2>

      {threads.length === 0 && !draft && (
        <p className="mt-2 text-[13px] text-faint">
          {canAnnotate
            ? "Noch keine Kommentare. Markiere eine Textstelle für eine Anmerkung an genau dieser Stelle — oder schreib unten einen Kommentar zur ganzen Seite."
            : "Noch keine Kommentare. Schreib unten einen Kommentar zur ganzen Seite. Anmerkungen an einer einzelnen Textstelle brauchen Schreibrechte, weil die Markierung im Dokument selbst liegt."}
        </p>
      )}

      {draft && (
        <div
          ref={draftRef}
          className="mt-3 rounded-xl border border-accent/40 bg-accent-soft/40 p-4"
        >
          {draft.anchorText && (
            <p className="mb-2 border-l-2 border-amber-400 pl-2 text-[13px] italic text-muted">
              „{draft.anchorText}“
            </p>
          )}
          <form
            action={async (fd) => {
              await createThreadAction(fd);
              // Markierung bleibt bestehen: der Thread existiert jetzt.
              setDraft(null);
              router.refresh();
            }}
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="pageId" value={pageId} />
            <input type="hidden" name="threadId" value={draft.id} />
            <input
              type="hidden"
              name="anchorText"
              value={draft.anchorText}
            />
            <textarea
              name="body"
              required
              autoFocus
              rows={2}
              aria-label="Kommentar"
              placeholder="Kommentar schreiben…"
              className="w-full rounded-lg border border-line-strong bg-surface p-2.5 text-sm outline-none focus-visible:border-accent"
            />
            <div className="mt-2 flex gap-2">
              <Button type="submit" size="sm">
                Kommentieren
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelDraft}
              >
                Abbrechen
              </Button>
            </div>
          </form>
        </div>
      )}

      <ul className="mt-3 space-y-3">
        {open.map((t) => (
          <Thread
            key={t.id}
            thread={t}
            slug={slug}
            currentUserId={currentUserId}
            canComment={canComment}
            active={activeId === t.id}
          />
        ))}
      </ul>

      {resolved.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            aria-expanded={showResolved}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showResolved && "rotate-180",
              )}
            />
            {resolved.length} erledigt
          </button>
          {showResolved && (
            <ul className="mt-3 space-y-3">
              {resolved.map((t) => (
                <Thread
                  key={t.id}
                  thread={t}
                  slug={slug}
                  currentUserId={currentUserId}
                  canComment={canComment}
                  active={activeId === t.id}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {canComment && !draft && (
        <PageCommentComposer slug={slug} pageId={pageId} />
      )}
    </section>
  );
}

/**
 * Kommentar zur ganzen Seite, ohne Textstelle.
 *
 * Bisher gab es nur textverankerte Threads — eine allgemeine Rückfrage
 * zur Seite hatte gar keinen Ort. Der Thread entsteht mit derselben
 * Action, nur ohne Anker und ohne Markierung im Dokument.
 */
function PageCommentComposer({
  slug,
  pageId,
}: {
  slug: string;
  pageId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Die Thread-ID muss dieselbe Form haben wie bei verankerten Threads.
  const [threadId, setThreadId] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setThreadId(crypto.randomUUID());
          setOpen(true);
        }}
        className="mt-4 flex w-full items-center gap-2 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-left text-[13px] text-muted transition-colors hover:border-accent/50 hover:text-ink"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Kommentar zur Seite schreiben
      </button>
    );
  }

  return (
    <form
      className="mt-4 rounded-xl border border-line bg-surface p-4 shadow-soft"
      action={async (fd) => {
        await createThreadAction(fd);
        setOpen(false);
        setThreadId(null);
        router.refresh();
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="threadId" value={threadId ?? ""} />
      <textarea
        name="body"
        required
        autoFocus
        rows={2}
        aria-label="Kommentar zur Seite"
        placeholder="Kommentar zur ganzen Seite…"
        className="w-full rounded-lg border border-line-strong bg-surface p-2.5 text-sm outline-none focus-visible:border-accent"
      />
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="sm">
          Kommentieren
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setThreadId(null);
          }}
        >
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

function Thread({
  thread,
  slug,
  currentUserId,
  canComment,
  active,
}: {
  thread: ThreadData;
  slug: string;
  currentUserId: string;
  canComment: boolean;
  active: boolean;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const { toast } = useToast();

  return (
    <li
      id={`comment-thread-${thread.id}`}
      className={cn(
        "rounded-xl border bg-surface p-4 shadow-soft transition-colors duration-300",
        active ? "border-accent ring-2 ring-accent-soft" : "border-line",
        thread.resolved && "opacity-60",
      )}
    >
      {thread.anchorText && (
        <button
          type="button"
          onClick={() => scrollToMark(thread.id)}
          title="Zur Textstelle springen"
          className="group mb-2 flex w-full items-start gap-1.5 border-l-2 border-amber-400 pl-2 text-left text-[13px] italic text-muted transition-colors hover:text-ink"
        >
          <span className="min-w-0 flex-1">„{thread.anchorText}“</span>
          <Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
      <CommentRow
        author={thread.author}
        body={thread.body}
        createdAt={thread.createdAt}
        edited={thread.edited}
        canDelete={canComment && thread.author?.id === currentUserId}
        canEdit={canComment && thread.author?.id === currentUserId}
        commentId={thread.id}
        isThreadRoot
        slug={slug}
      />

      {thread.replies.length > 0 && (
        <ul className="mt-2 space-y-2 border-l border-line pl-4">
          {thread.replies.map((r) => (
            <li key={r.id}>
              <CommentRow
                author={r.author}
                body={r.body}
                createdAt={r.createdAt}
                edited={r.edited}
                canDelete={canComment && r.author?.id === currentUserId}
                canEdit={canComment && r.author?.id === currentUserId}
                commentId={r.id}
                slug={slug}
              />
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <div className="mt-3 flex items-center gap-2">
          {replying ? (
            <form
              className="flex-1"
              action={async (fd) => {
                await replyAction(fd);
                setReplying(false);
                router.refresh();
              }}
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="threadId" value={thread.id} />
              <textarea
                name="body"
                required
                autoFocus
                rows={2}
                aria-label="Antwort"
                placeholder="Antworten…"
                className="w-full rounded-lg border border-line-strong bg-surface p-2.5 text-sm outline-none focus-visible:border-accent"
              />
              <div className="mt-2 flex gap-2">
                <Button type="submit" size="sm">
                  Antworten
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setReplying(false)}
                >
                  Abbrechen
                </Button>
              </div>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setReplying(true)}
                className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
                Antworten
              </button>
              <form
                action={async (fd) => {
                  await resolveThreadAction(fd);
                  if (!thread.resolved) removeMark(thread.id);
                  // Erledigte Threads wandern in den eingeklappten
                  // Bereich, deshalb hier sagen, wohin sie verschwinden.
                  toast({
                    title: thread.resolved
                      ? "Thread wieder geöffnet"
                      : "Thread erledigt",
                    description: thread.resolved
                      ? undefined
                      : "Zu finden im Bereich „erledigt“ am Ende der Kommentare.",
                    variant: "success",
                  });
                  router.refresh();
                }}
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="threadId" value={thread.id} />
                <button className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
                  {thread.resolved ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Wieder öffnen
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Auflösen
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function CommentRow({
  author,
  body,
  createdAt,
  edited = false,
  canDelete,
  canEdit = false,
  commentId,
  isThreadRoot = false,
  slug,
}: {
  author: Author;
  body: string;
  createdAt: string;
  /** Wurde der Text nach dem Anlegen geändert? */
  edited?: boolean;
  canDelete: boolean;
  canEdit?: boolean;
  commentId: string;
  /** Beim Löschen des Wurzelkommentars muss die Textmarkierung mit weg. */
  isThreadRoot?: boolean;
  slug: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);

  return (
    <div className="group flex items-start gap-2.5">
      <Avatar name={author?.name ?? "Gelöscht"} size={26} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="font-medium">{author?.name ?? "Gelöscht"}</span>
          <time
            dateTime={createdAt}
            className="ml-2 text-faint"
          >
            {new Date(createdAt).toLocaleString("de-CH", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
          {edited && (
            <span className="ml-1.5 text-faint" title="Nachträglich geändert">
              (bearbeitet)
            </span>
          )}
        </p>
        {editing ? (
          <form
            className="mt-1"
            action={async (fd) => {
              await editCommentAction(fd);
              setEditing(false);
              router.refresh();
            }}
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="commentId" value={commentId} />
            <textarea
              name="body"
              required
              autoFocus
              rows={2}
              defaultValue={body}
              aria-label="Kommentar bearbeiten"
              className="w-full rounded-lg border border-line-strong bg-surface p-2 text-sm outline-none focus-visible:border-accent"
            />
            <div className="mt-1.5 flex gap-2">
              <Button type="submit" size="sm">
                Speichern
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Abbrechen
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap text-sm">{body}</p>
        )}
      </div>
      {canEdit && !editing && (
        <button
          type="button"
          title="Kommentar bearbeiten"
          aria-label="Kommentar bearbeiten"
          onClick={() => setEditing(true)}
          className="grid h-6 w-6 place-items-center rounded text-faint opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {canDelete && (
        <form
          action={async (fd) => {
            await deleteCommentAction(fd);
            // Ohne das bliebe die gelbe Markierung ohne Thread zurück.
            if (isThreadRoot) removeMark(commentId);
            toast({
              title: isThreadRoot ? "Thread gelöscht" : "Antwort gelöscht",
              variant: "success",
            });
            router.refresh();
          }}
        >
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="commentId" value={commentId} />
          <ConfirmButton
            title="Kommentar löschen"
            message={
              isThreadRoot
                ? "Diesen Thread mit allen Antworten löschen? Die Markierung im Text wird ebenfalls entfernt."
                : "Diese Antwort löschen?"
            }
            confirmLabel="Löschen"
            className="grid h-6 w-6 place-items-center rounded text-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </ConfirmButton>
        </form>
      )}
    </div>
  );
}
