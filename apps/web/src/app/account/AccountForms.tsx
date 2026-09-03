"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  updateProfileAction,
  changePasswordAction,
  updateNotificationPrefsAction,
  type AccountState,
} from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";

export type EmailNotificationMode = "INSTANT" | "DAILY" | "OFF";

const NOTIFICATION_OPTIONS: {
  value: EmailNotificationMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "INSTANT",
    label: "Sofort",
    hint: "Kurz nach der Erwähnung oder Antwort, mehrere Ereignisse gebündelt.",
  },
  {
    value: "DAILY",
    label: "Täglich als Zusammenfassung",
    hint: "Eine Mail pro Tag mit allem, was seit der letzten passiert ist.",
  },
  {
    value: "OFF",
    label: "Aus",
    hint: "Benachrichtigungen erscheinen nur in der App.",
  },
];

export function NotificationPrefsForm({
  mode,
  mailConfigured,
}: {
  mode: EmailNotificationMode;
  mailConfigured: boolean;
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    updateNotificationPrefsAction,
    undefined,
  );
  return (
    <form
      action={action}
      className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <div>
        <h2 className="text-sm font-semibold">Benachrichtigungen per Mail</h2>
        <p className="mt-1 text-[13px] text-muted">
          Erwähnungen und Antworten auf deine Kommentare zusätzlich per
          E-Mail erhalten.
        </p>
      </div>
      {!mailConfigured && (
        <p className="rounded-lg border border-line bg-subtle px-3 py-2 text-[13px] text-muted">
          Auf dieser Instanz ist kein Mail-Versand (SMTP) eingerichtet.
          Die Einstellung wird gespeichert, greift aber erst, sobald eine
          Admin-Person SMTP konfiguriert.
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="sr-only">Zustellung</legend>
        {NOTIFICATION_OPTIONS.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-subtle has-[:checked]:border-accent/60 has-[:checked]:bg-accent-soft/30"
          >
            <input
              type="radio"
              name="emailNotifications"
              value={o.value}
              defaultChecked={mode === o.value}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">
                {o.label}
              </span>
              <span className="block text-[13px] text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Status state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
      </Button>
    </form>
  );
}

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
