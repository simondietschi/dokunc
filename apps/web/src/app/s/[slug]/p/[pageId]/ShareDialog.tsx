"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import {
  createShareAction,
  revokeShareAction,
  type ShareState,
} from "../../actions";

export type ShareRow = {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  includeChildren: boolean;
};

/**
 * Freigabelinks einer Seite.
 *
 * Der Link mit Token erscheint genau einmal, direkt nach dem Erzeugen:
 * gespeichert wird nur sein Hash. Bestehende Freigaben lassen sich
 * daher nur zurückziehen, nicht erneut anzeigen — dieselbe Regel wie
 * bei Einladungen.
 */
export function ShareDialog({
  slug,
  pageId,
  shares,
}: {
  slug: string;
  pageId: string;
  shares: ShareRow[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState<ShareState, FormData>(
    createShareAction,
    undefined,
  );

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ohne Zwischenablage-Recht bleibt der Knopf wirkungslos */
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Seite teilen"
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        <Link2 className="h-4 w-4" />
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Seite teilen"
        description="Wer den Link hat, darf diese Seite lesen — ohne Konto."
      >
        <form action={action} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pageId" value={pageId} />

          <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              name="includeChildren"
              className="h-3.5 w-3.5 rounded border-line-strong accent-[var(--accent)]"
            />
            Unterseiten mitfreigeben
          </label>

          <div>
            <label
              htmlFor="share-days"
              className="mb-1.5 block text-[13px] font-medium text-muted"
            >
              Gültigkeit
            </label>
            <select
              id="share-days"
              name="days"
              defaultValue="30"
              className="h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink focus-visible:border-accent focus-visible:outline-none"
            >
              <option value="7">7 Tage</option>
              <option value="30">30 Tage</option>
              <option value="90">90 Tage</option>
              <option value="0">Unbegrenzt</option>
            </select>
          </div>

          {state?.error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {state.error}
            </p>
          )}

          <Button type="submit" size="sm" disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Link erzeugen"
            )}
          </Button>
        </form>

        {state?.url && (
          <div className="mt-4 rounded-lg border border-accent/40 bg-accent-soft/40 p-3">
            <p className="text-[12.5px] text-muted">
              Dieser Link wird nur jetzt angezeigt.
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                readOnly
                value={state.url}
                aria-label="Freigabelink"
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 flex-1 rounded-md border border-line bg-surface px-2 font-mono text-[12px] text-ink"
              />
              <button
                type="button"
                onClick={() => void copy(state.url!)}
                title="Link kopieren"
                aria-label="Link kopieren"
                className="grid h-8 w-8 place-items-center rounded-md border border-line text-muted transition-colors hover:text-ink"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        )}

        {shares.length > 0 && (
          <div className="mt-5">
            <h3 className="text-[13px] font-semibold text-muted">
              Aktive Links ({shares.length})
            </h3>
            <ul className="mt-2 space-y-1.5">
              {shares.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[12.5px]"
                >
                  <span className="min-w-0 text-muted">
                    seit{" "}
                    <time dateTime={s.createdAt}>
                      {new Date(s.createdAt).toLocaleDateString("de-CH")}
                    </time>
                    {s.expiresAt
                      ? ` · bis ${new Date(s.expiresAt).toLocaleDateString("de-CH")}`
                      : " · unbegrenzt"}
                    {s.includeChildren && " · mit Unterseiten"}
                  </span>
                  <form action={revokeShareAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="pageId" value={pageId} />
                    <input type="hidden" name="shareId" value={s.id} />
                    <button
                      title="Freigabe zurückziehen"
                      aria-label="Freigabe zurückziehen"
                      className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
    </>
  );
}
