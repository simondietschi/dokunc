"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  updateProfileAction,
  changePasswordAction,
  updateNotificationPrefsAction,
  deleteAccountAction,
  type AccountState,
} from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";

function Status({ state }: { state: AccountState }) {
  if (state?.error)
    return (
      <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
        {state.error}
      </p>
    );
  if (state?.success)
    return (
      <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600">
        {state.success}
      </p>
    );
  return null;
}

export function ProfileForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    updateProfileAction,
    undefined,
  );
  return (
    <form
      action={action}
      className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <h2 className="text-sm font-semibold">Profil</h2>
      <Field label="Name">
        <Input name="name" defaultValue={name} required />
      </Field>
      <Status state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    changePasswordAction,
    undefined,
  );
  return (
    <form
      action={action}
      className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <h2 className="text-sm font-semibold">Passwort ändern</h2>
      <Field label="Aktuelles Passwort">
        <Input name="current" type="password" required />
      </Field>
      <Field label="Neues Passwort">
        <Input name="next" type="password" required />
      </Field>
      <Status state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Passwort ändern"
        )}
      </Button>
    </form>
  );
}

/**
 * E-Mail-Benachrichtigungen.
 *
 * Bewusst getrennt nach Anlass: eine Erwähnung ist eine direkte
 * Ansprache, ein Kommentar auf einer verfolgten Seite ist es nicht.
 */
export function NotificationForm({
  emailOnMention,
  emailOnComment,
}: {
  emailOnMention: boolean;
  emailOnComment: boolean;
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    updateNotificationPrefsAction,
    undefined,
  );
  return (
    <form
      action={action}
      className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <h2 className="text-sm font-semibold">E-Mail-Benachrichtigungen</h2>
      <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
        <input
          type="checkbox"
          name="emailOnMention"
          defaultChecked={emailOnMention}
          className="h-3.5 w-3.5 rounded border-line-strong accent-[var(--accent)]"
        />
        Wenn mich jemand mit @ erwähnt
      </label>
      <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
        <input
          type="checkbox"
          name="emailOnComment"
          defaultChecked={emailOnComment}
          className="h-3.5 w-3.5 rounded border-line-strong accent-[var(--accent)]"
        />
        Bei Kommentaren auf Seiten, mit denen ich zu tun habe
      </label>
      <p className="text-[12.5px] text-faint">
        Ohne konfiguriertes SMTP verschickt die Instanz keine E-Mails; die
        Glocke in der App funktioniert unabhängig davon.
      </p>
      <Status state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
      </Button>
    </form>
  );
}

/**
 * Konto löschen.
 *
 * Zweistufig: erst aufklappen, dann Passwort. Ein einzelner Klick soll
 * ein Konto nicht auflösen.
 */
export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    deleteAccountAction,
    undefined,
  );
  const [armed, setArmed] = useState(false);

  return (
    <div className="rounded-xl border border-danger/30 bg-surface p-5 shadow-soft">
      <h2 className="text-sm font-semibold text-danger">Konto löschen</h2>
      <p className="mt-1 text-[13px] text-muted">
        Deine Mitgliedschaften, Sitzungen, Favoriten und
        Benachrichtigungen verschwinden. Seiten und Kommentare bleiben
        erhalten und verlieren nur die Zuordnung zu dir — der Text
        anderer Menschen gehört nicht zu deinen Daten.
      </p>

      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="mt-3 inline-flex items-center rounded-lg border border-danger/40 px-3 py-1.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10"
        >
          Konto löschen
        </button>
      ) : (
        <form action={action} className="mt-3 space-y-3">
          <Field label="Passwort zur Bestätigung">
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Status state={state} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[13px] font-medium text-white transition-opacity disabled:opacity-60"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Endgültig löschen"
              )}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setArmed(false)}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
