"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2, KeyRound, MailCheck, ArrowLeft } from "lucide-react";
import { requestResetAction, type ResetState } from "../reset/actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { stagger } from "../stagger";

export default function ForgotPage() {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    requestResetAction,
    undefined,
  );

  if (state?.sent) {
    return (
      <div>
        <div
          className="grid h-12 w-12 place-items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10"
          style={stagger(0)}
        >
          <MailCheck className="h-5 w-5 text-emerald-500" />
        </div>
        <h2
          className="mt-5 text-2xl font-semibold tracking-tight text-ink"
          style={stagger(1)}
        >
          E-Mail unterwegs
        </h2>
        <p
          className="mt-2 text-sm leading-relaxed text-muted"
          style={stagger(2)}
        >
          Falls ein Konto mit dieser Adresse existiert, haben wir dir
          einen Link zum Zurücksetzen geschickt. Der Link ist eine Stunde
          gültig — prüfe auch den Spam-Ordner.
        </p>
        <p className="mt-8 text-sm text-muted" style={stagger(3)}>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Zurück zur Anmeldung
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent-soft"
        style={stagger(0)}
      >
        <KeyRound className="h-5 w-5 text-accent" />
      </div>
      <h2
        className="mt-5 text-2xl font-semibold tracking-tight text-ink"
        style={stagger(1)}
      >
        Passwort vergessen
      </h2>
      <p className="mt-1.5 text-sm text-muted" style={stagger(2)}>
        Wir senden dir einen Link zum Zurücksetzen.
      </p>

      <form action={action} className="mt-8 space-y-4">
        <div style={stagger(3)}>
          <Field label="E-Mail">
            <Input
              name="email"
              type="email"
              placeholder="alex@team.de"
              autoComplete="email"
              autoFocus
              required
            />
          </Field>
        </div>
        {state?.error && (
          <p className="dk-shake rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </p>
        )}
        <div style={stagger(4)}>
          <Button
            type="submit"
            size="lg"
            disabled={pending}
            className="w-full"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Link senden"
            )}
          </Button>
        </div>
      </form>

      <div
        className="mt-8 border-t border-line pt-5 text-center text-sm text-muted"
        style={stagger(5)}
      >
        <Link
          href="/login"
          className="font-medium text-accent hover:underline"
        >
          Zurück zur Anmeldung
        </Link>
      </div>
    </div>
  );
}
