"use client";

import { useActionState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { leaveSpaceAction, type SettingsState } from "../settings/actions";

/** "Space verlassen" fuer die angemeldete Person (mit Rueckfrage). */
export function LeaveSpaceForm({
  slug,
  spaceName,
}: {
  slug: string;
  spaceName: string;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    leaveSpaceAction,
    undefined,
  );
  return (
    <form
      action={action}
      className="mt-12 flex flex-col gap-3 rounded-xl border border-dashed border-line-strong bg-subtle/40 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <input type="hidden" name="slug" value={slug} />
      <div>
        <p className="text-sm font-medium">Space verlassen</p>
        <p className="text-[13px] text-muted">
          Du verlierst den Zugriff auf „{spaceName}“, bis dich jemand
          erneut einlädt.
        </p>
        {state?.error && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {state.error}
          </p>
        )}
      </div>
      <ConfirmButton
        message={`„${spaceName}“ wirklich verlassen?`}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogOut className="h-4 w-4" />
        )}
        Space verlassen
      </ConfirmButton>
    </form>
  );
}
