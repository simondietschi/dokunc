"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Send } from "lucide-react";
import { inviteMemberAction, type FormState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    inviteMemberAction,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <input type="hidden" name="slug" value={slug} />
      <h3 className="text-sm font-semibold">Person einladen</h3>
      <p className="mt-1 text-[13px] text-muted">
        Es wird eine sichere, 7 Tage gültige Einladung per E-Mail
        verschickt.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          name="email"
          type="email"
          placeholder="person@team.de"
          required
          className="flex-1"
        />
        <select
          name="role"
          defaultValue="MEMBER"
          className="h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft"
        >
          <option value="ADMIN">Admin</option>
          <option value="MEMBER">Mitglied</option>
          <option value="VIEWER">Betrachter</option>
        </select>
        <Button type="submit" disabled={pending} className="sm:w-auto">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Send className="h-4 w-4" />
              Einladen
            </>
          )}
        </Button>
      </div>
      {state?.error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600">
          {state.success}
        </p>
      )}
    </form>
  );
}
