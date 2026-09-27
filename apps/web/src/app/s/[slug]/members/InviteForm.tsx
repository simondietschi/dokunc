"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Send } from "lucide-react";
import { inviteMemberAction, type FormState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OneTimeLink } from "@/components/ui/OneTimeLink";

/** Was ein Einladen für die angemeldete Person bewirkt. */
export type InviteDelivery = "mail" | "link" | "none";

const EINLEITUNG: Record<InviteDelivery, string> = {
  mail: "Es wird eine sichere, 7 Tage gültige Einladung per E-Mail verschickt.",
  link: "Es ist kein Mailserver eingerichtet. Nach dem Einladen erscheint hier ein sicherer, 7 Tage gültiger Link, den du selbst weitergibst.",
  none: "Es ist kein Mailserver eingerichtet. Eine Einladung erreicht die Person so nicht; den Link zur Weitergabe von Hand sehen nur Admin-Personen der Instanz.",
};

export function InviteForm({
  slug,
  delivery,
}: {
  slug: string;
  delivery: InviteDelivery;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    inviteMemberAction,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success || state?.link) formRef.current?.reset();
  }, [state]);

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-soft">
      <form ref={formRef} action={action}>
        <input type="hidden" name="slug" value={slug} />
        <h3 className="text-sm font-semibold">Person einladen</h3>
        <p className="mt-1 text-[13px] text-muted">{EINLEITUNG[delivery]}</p>
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
      {/* Ausserhalb des Formulars: siehe OneTimeLink. Der Link lebt nur im
          Zustand von useActionState, nie in localStorage oder der URL. */}
      {state?.link && (
        <OneTimeLink url={state.link.url} label="Einladungslink">
          <p className="text-[13px] font-medium text-ink">
            Link für {state.link.email}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Gib diesen Link selbst an {state.link.email} weiter, zum Beispiel
            im Chat. Wer ihn hat, kann mit dieser Adresse ein Konto anlegen und
            beitreten. Er ist 7 Tage gültig und wird nur jetzt angezeigt. Geht
            er verloren, dieselbe Adresse erneut einladen: der alte Link wird
            damit ungültig.
          </p>
        </OneTimeLink>
      )}
    </div>
  );
}
