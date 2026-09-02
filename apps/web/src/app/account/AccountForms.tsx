"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  updateProfileAction,
  changePasswordAction,
  updateDigestAction,
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

export function DigestForm({
  enabled,
  smtpConfigured,
}: {
  enabled: boolean;
  smtpConfigured: boolean;
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    updateDigestAction,
    undefined,
  );
  return (
    <form
      action={action}
      className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <h2 className="text-sm font-semibold">Benachrichtigungen per Mail</h2>
      <label className="flex cursor-pointer items-start gap-3 text-[13px]">
        <input
          type="checkbox"
          name="digest"
          defaultChecked={enabled}
          className="mt-0.5 accent-accent"
        />
        <span>
          <span className="block font-medium text-ink">
            Tägliche Zusammenfassung
          </span>
          <span className="block text-muted">
            Einmal am Tag eine Mail mit ungelesenen Erwähnungen, Kommentaren
            und Änderungen an abonnierten Seiten.
          </span>
        </span>
      </label>
      {!smtpConfigured && (
        <p className="rounded-lg border border-line bg-subtle px-3 py-2 text-[12.5px] text-muted">
          Hinweis: Auf dieser Instanz ist kein Mailversand (SMTP) konfiguriert.
          Die Einstellung wird gespeichert, Mails gehen erst nach der
          Konfiguration raus.
        </p>
      )}
      <Status state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
      </Button>
    </form>
  );
}
