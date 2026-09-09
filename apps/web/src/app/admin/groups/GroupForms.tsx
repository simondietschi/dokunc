"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { createGroupAction, type GroupState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";

/** Neue Gruppe anlegen. */
export function NewGroupForm() {
  const [state, action, pending] = useActionState<GroupState, FormData>(
    createGroupAction,
    undefined,
  );
  return (
    <form
      action={action}
      className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <h2 className="text-sm font-semibold">Neue Gruppe</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" placeholder="Entwicklung" required />
        </Field>
        <Field label="Beschreibung (optional)">
          <Input name="description" placeholder="Wer dazugehört" />
        </Field>
      </div>
      {state?.error && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600">
          {state.success}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Plus className="h-4 w-4" />
            Anlegen
          </>
        )}
      </Button>
    </form>
  );
}

/**
 * Person zur Gruppe hinzufügen.
 *
 * Ein Auswahlfeld statt einer Suche: eine selbst gehostete Instanz hat
 * überschaubar viele Konten, und die Liste zeigt sofort, wer schon drin
 * ist (die ist nämlich gar nicht erst dabei).
 */
export function AddMemberForm({
  groupId,
  candidates,
  action,
}: {
  groupId: string;
  candidates: { id: string; name: string; email: string }[];
  action: (form: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (candidates.length === 0) {
    return (
      <p className="text-[12.5px] text-faint">
        Alle Konten sind schon in dieser Gruppe.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        <Plus className="h-3.5 w-3.5" />
        Person hinzufügen
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <select
        name="userId"
        defaultValue={candidates[0].id}
        className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink"
      >
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.email})
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
