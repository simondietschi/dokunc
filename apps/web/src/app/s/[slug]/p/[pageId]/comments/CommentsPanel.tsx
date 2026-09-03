"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  CheckCircle2,
  RotateCcw,
  Trash2,
  CornerDownRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import {
  createThreadAction,
  replyAction,
  resolveThreadAction,
  deleteCommentAction,
} from "./actions";

type Author = { id: string; name: string } | null;
export type ThreadData = {
  id: string;
  body: string;
  anchorText: string | null;
  resolved: boolean;
  createdAt: string;
  author: Author;
  replies: {
    id: string;
    body: string;
    createdAt: string;
    author: Author;
  }[];
};

/** Wird vom Editor-Toolbar-Button gefeuert (Text markiert -> Thread). */
export type NewThreadEvent = CustomEvent<{
  id: string;
  anchorText: string;
}>;

export function CommentsPanel({
  slug,
  pageId,
  currentUserId,
  canComment,
  threads,
}: {
  slug: string;
  pageId: string;
  currentUserId: string;
  canComment: boolean;
  threads: ThreadData[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<{
    id: string;
    anchorText: string;
  } | null>(null);
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

  function cancelDraft() {
    if (draft) {
      // Editor entfernt die verwaiste Markierung wieder.
      window.dispatchEvent(
        new CustomEvent("dokunc:remove-comment-mark", {
          detail: { id: draft.id },
        }),
      );
    }
    setDraft(null);
  }

  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);

  if (!draft && threads.length === 0) return null;

  return (
    <section className="mt-6 border-t border-line pt-6">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        <MessageSquare className="h-3.5 w-3.5" />
        Kommentare ({open.length})
      </h2>

      {draft && (
        <div
          ref={draftRef}
          className="mt-3 rounded-xl border border-accent/40 bg-accent-soft/40 p-4"
        >
          {draft.anchorText && (
            <p className="mb-2 border-l-2 border-amber-400 pl-2 text-[13px] italic text-muted">
              „{draft.anchorText}"
            </p>
          )}
          <form
            action={async (fd) => {
              await createThreadAction(fd);
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
        {[...open, ...resolved].map((t) => (
          <Thread
            key={t.id}
            thread={t}
            slug={slug}
            currentUserId={currentUserId}
            canComment={canComment}
          />
        ))}
      </ul>
    </section>
  );
}

function Thread({
  thread,
  slug,
  currentUserId,
  canComment,
}: {
  thread: ThreadData;
  slug: string;
  currentUserId: string;
  canComment: boolean;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  // Aufloesen/Wiederoeffnen sofort anzeigen; der Server bestaetigt den
  // Zustand mit dem naechsten Refresh (dann wird die Vorgabe verworfen).
  const [pendingResolved, setPendingResolved] = useState<boolean | null>(
    null,
  );
  useEffect(() => {
    setPendingResolved(null);
  }, [thread.resolved]);
  const resolved = pendingResolved ?? thread.resolved;

  return (
    <li
      className={cn(
        "rounded-xl border border-line bg-surface p-4 shadow-soft",
        resolved && "opacity-60",
      )}
    >
      {thread.anchorText && (
        <p className="mb-2 border-l-2 border-amber-400 pl-2 text-[13px] italic text-muted">
          „{thread.anchorText}"
        </p>
      )}
      <CommentRow
        author={thread.author}
        body={thread.body}
        createdAt={thread.createdAt}
        canDelete={canComment && thread.author?.id === currentUserId}
        commentId={thread.id}
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
                canDelete={canComment && r.author?.id === currentUserId}
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
                onClick={() => setReplying(true)}
                className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
                Antworten
              </button>
              <form
                action={async (fd) => {
                  const wasResolved = resolved;
                  setPendingResolved(!wasResolved);
                  await resolveThreadAction(fd);
                  if (!wasResolved) {
                    // Markierung im Text entfernen.
                    window.dispatchEvent(
                      new CustomEvent("dokunc:remove-comment-mark", {
                        detail: { id: thread.id },
                      }),
                    );
                  }
                  router.refresh();
                }}
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="threadId" value={thread.id} />
                <button className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
                  {resolved ? (
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
  canDelete,
  commentId,
  slug,
}: {
  author: Author;
  body: string;
  createdAt: string;
  canDelete: boolean;
  commentId: string;
  slug: string;
}) {
  const router = useRouter();
  return (
    <div className="group flex items-start gap-2.5">
      <Avatar name={author?.name ?? "Gelöscht"} size={26} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="font-medium">{author?.name ?? "Gelöscht"}</span>
          <span className="ml-2 text-faint">
            {new Date(createdAt).toLocaleString("de-DE", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm">{body}</p>
      </div>
      {canDelete && (
        <form
          action={async (fd) => {
            await deleteCommentAction(fd);
            router.refresh();
          }}
        >
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="commentId" value={commentId} />
          <button
            title="Löschen"
            className="grid h-6 w-6 place-items-center rounded text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </form>
      )}
    </div>
  );
}
