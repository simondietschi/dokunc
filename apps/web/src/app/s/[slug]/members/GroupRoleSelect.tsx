"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  addSpaceGroupAction,
  updateSpaceGroupRoleAction,
} from "./actions";
import { Button } from "@/components/ui/Button";

/** Rolle einer bereits zugeordneten Gruppe ändern. */
export function GroupRoleSelect({
  slug,
  spaceGroupId,
  role,
  roles,
}: {
  slug: string;
  spaceGroupId: string;
  role: string;
  roles: readonly string[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={updateSpaceGroupRoleAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="spaceGroupId" value={spaceGroupId} />
      <select
        name="role"
        defaultValue={role}
        aria-label="Rolle der Gruppe"
        onChange={() => ref.current?.requestSubmit()}
        className="h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink focus-visible:border-accent focus-visible:outline-none"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </form>
  );
}

/**
 * Gruppe in den Space aufnehmen.
 *
 * Die Liste enthält nur Gruppen, die noch nicht zugeordnet sind — eine
 * zweite Zuordnung derselben Gruppe gäbe es ohnehin nicht.
 */
export function AddSpaceGroupForm({
  slug,
  groups,
  roles,
}: {
  slug: string;
  groups: { id: string; name: string }[];
  roles: readonly string[];
}) {
  const [open, setOpen] = useState(false);

  if (groups.length === 0) {
    return (
      <p className="mt-3 text-[12.5px] text-faint">
        Keine weitere Gruppe verfügbar. Gruppen legt die Administration
        unter „Gruppen" an.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        <Plus className="h-3.5 w-3.5" />
        Gruppe hinzufügen
      </button>
    );
  }
  return (
    <form
      action={addSpaceGroupAction}
      className="mt-3 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="slug" value={slug} />
      <select
        name="groupId"
        defaultValue={groups[0].id}
        aria-label="Gruppe"
        className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <select
        name="role"
        defaultValue="MEMBER"
        aria-label="Rolle"
        className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
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
        onClick={() => setOpen(false)}
      >
        Abbrechen
      </Button>
    </form>
  );
}
