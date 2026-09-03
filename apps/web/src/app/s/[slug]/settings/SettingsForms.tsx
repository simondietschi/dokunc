"use client";

import { useActionState, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import {
  QUICK_ICONS,
  SPACE_DESCRIPTION_MAX,
  SPACE_NAME_MAX,
  SPACE_NAME_MIN,
} from "@/lib/space-settings";
import {
  deleteSpaceAction,
  updateSpaceAction,
  type SettingsState,
} from "./actions";

function Status({ state }: { state: SettingsState }) {
  if (state?.error)
    return (
      <p
        role="alert"
        className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
      >
        {state.error}
      </p>
    );
  if (state?.success)
    return (
      <p
        role="status"
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600"
      >
        {state.success}
      </p>
    );
  return null;
}

export function GeneralForm({
  slug,
  name,
  description,
  icon,
}: {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateSpaceAction,
    undefined,
  );
  const [iconValue, setIconValue] = useState(icon ?? "");
  const [nameValue, setNameValue] = useState(name);

  return (
    <form
      action={action}
      className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <input type="hidden" name="slug" value={slug} />
      <div>
        <h2 className="text-sm font-semibold">Allgemein</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Name und Icon erscheinen in der Sidebar und in der Space-Übersicht.
        </p>
      </div>

      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-line bg-subtle text-2xl"
        >
          {iconValue.trim() || (
            <span className="bg-gradient-to-br from-accent to-violet-500 bg-clip-text text-xl font-bold text-transparent">
              {nameValue.trim()[0]?.toUpperCase() ?? "?"}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-4">
          <Field label="Name">
            <Input
              name="name"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              required
              minLength={SPACE_NAME_MIN}
              maxLength={SPACE_NAME_MAX}
            />
          </Field>
          <Field label="Icon (Emoji, optional)">
            <Input
              name="icon"
              value={iconValue}
              onChange={(e) => setIconValue(e.target.value)}
              placeholder="z. B. 📘"
              maxLength={8}
              className="w-28"
              autoComplete="off"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5" aria-label="Schnellauswahl Icon">
            {QUICK_ICONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIconValue(emoji)}
                aria-label={`Icon ${emoji} wählen`}
                aria-pressed={iconValue === emoji}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-lg border text-lg transition-colors",
                  iconValue === emoji
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-surface hover:border-line-strong hover:bg-subtle",
                )}
              >
                {emoji}
              </button>
            ))}
            {iconValue && (
              <button
                type="button"
                onClick={() => setIconValue("")}
                className="h-9 rounded-lg px-2.5 text-[12.5px] text-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                Kein Icon
              </button>
            )}
          </div>
        </div>
      </div>

      <Field label="Beschreibung (optional)">
        <textarea
          name="description"
          defaultValue={description ?? ""}
          maxLength={SPACE_DESCRIPTION_MAX}
          rows={3}
          className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint transition-all duration-150 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft"
          placeholder="Wofür ist dieser Space da?"
        />
      </Field>

      <Status state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
      </Button>
    </form>
  );
}

export function DeleteSpaceForm({
  slug,
  name,
}: {
  slug: string;
  name: string;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    deleteSpaceAction,
    undefined,
  );
  const [confirm, setConfirm] = useState("");
  const ready = confirm === name;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <p className="text-[13px] text-muted">
        Löscht den Space mit allen Seiten, Versionen, Kommentaren und
        Anhängen endgültig. Das kann nicht rückgängig gemacht werden. Zur
        Bestätigung den Namen{" "}
        <span className="font-medium text-ink">{name}</span> eingeben.
      </p>
      <Input
        name="confirm"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={name}
        autoComplete="off"
        aria-label="Space-Name zur Bestätigung"
      />
      <Status state={state} />
      <Button
        type="submit"
        variant="danger"
        disabled={!ready || pending}
        className="border border-danger/30"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Trash2 className="h-4 w-4" />
            Space endgültig löschen
          </>
        )}
      </Button>
    </form>
  );
}
