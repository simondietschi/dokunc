"use client";

import { useState } from "react";
import { Lock, LockOpen, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import {
  addPageGrantAction,
  removePageGrantAction,
  togglePageRestrictionAction,
} from "../../actions";

export type GrantRow = {
  id: string;
  kind: "user" | "group";
  label: string;
  detail: string | null;
};

export type AccessCandidate = { id: string; label: string; detail: string };

/**
 * Zugriff auf eine Seite.
 *
 * Ungeschützt heisst: alle im Space sehen sie. Geschützt heisst: nur
 * die Eingetragenen — und die Space-Verwaltung, die sonst einen Teil
 * ihres eigenen Bereichs nicht mehr verwalten könnte. Der Schutz gilt
 * für den ganzen Unterbaum.
 */
export function AccessDialog({
  slug,
  pageId,
  isRestricted,
  inheritedFrom,
  grants,
  people,
  groups,
}: {
  slug: string;
  pageId: string;
  isRestricted: boolean;
  /** Titel der geschützten Seite weiter oben, falls der Schutz geerbt ist. */
  inheritedFrom: string | null;
  grants: GrantRow[];
  people: AccessCandidate[];
  groups: AccessCandidate[];
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<"user" | "group" | null>(null);
  const locked = isRestricted || !!inheritedFrom;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={locked ? "Zugriff: geschützt" : "Zugriff"}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-subtle ${
          locked ? "text-amber-600" : "text-muted hover:text-ink"
        }`}
      >
        {locked ? (
          <Lock className="h-4 w-4" />
        ) : (
          <LockOpen className="h-4 w-4" />
        )}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Zugriff auf diese Seite"
        description={
          inheritedFrom
            ? `Der Schutz kommt von „${inheritedFrom}" weiter oben im Baum. Dort lässt er sich ändern.`
            : isRestricted
              ? "Nur die Eingetragenen sehen diese Seite und ihre Unterseiten. Die Space-Verwaltung sieht sie immer."
              : "Alle mit Zugang zum Space sehen diese Seite."
        }
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Schliessen
          </Button>
        }
      >
        {!inheritedFrom && (
          <form action={togglePageRestrictionAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="pageId" value={pageId} />
            <Button
              type="submit"
              variant={isRestricted ? "secondary" : "primary"}
              size="sm"
            >
              {isRestricted ? (
                <>
                  <LockOpen className="h-3.5 w-3.5" />
                  Schutz aufheben
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  Seite schützen
                </>
              )}
            </Button>
            {!isRestricted && (
              <p className="mt-2 text-[12.5px] text-faint">
                Offene Freigabelinks dieser Seite werden dabei
                zurückgezogen.
              </p>
            )}
          </form>
        )}

        {locked && (
          <div className="mt-4 space-y-2">
            <h3 className="text-[13px] font-semibold">
              Zugriff haben ({grants.length})
            </h3>
            <ul className="space-y-1.5">
              {grants.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {g.kind === "group" && (
                      <Users className="h-3.5 w-3.5 shrink-0 text-faint" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {g.label}
                      </p>
                      {g.detail && (
                        <p className="truncate text-[11.5px] text-faint">
                          {g.detail}
                        </p>
                      )}
                    </div>
                  </div>
                  {!inheritedFrom && (
                    <form action={removePageGrantAction}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="pageId" value={pageId} />
                      <input type="hidden" name="grantId" value={g.id} />
                      <button
                        title="Zugriff entziehen"
                        className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  )}
                </li>
              ))}
              {grants.length === 0 && (
                <li className="text-[12.5px] text-faint">
                  Ausser der Space-Verwaltung sieht diese Seite niemand.
                </li>
              )}
            </ul>

            {!inheritedFrom && (
              <div className="pt-1">
                {adding === null ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={people.length === 0}
                      onClick={() => setAdding("user")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Person
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={groups.length === 0}
                      onClick={() => setAdding("group")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Gruppe
                    </Button>
                  </div>
                ) : (
                  <form
                    action={addPageGrantAction}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="pageId" value={pageId} />
                    <select
                      name={
                        adding === "user" ? "grantUserId" : "grantGroupId"
                      }
                      aria-label={adding === "user" ? "Person" : "Gruppe"}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
                    >
                      {(adding === "user" ? people : groups).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                          {c.detail ? ` (${c.detail})` : ""}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm">
                      Hinzufügen
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAdding(null)}
                    >
                      Abbrechen
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
