"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { requestResetAction, type ResetState } from "../reset/actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";

export default function ForgotPage() {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    requestResetAction,
    undefined,
  );

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">
        Passwort vergessen
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Wir senden dir einen Link zum Zurücksetzen.
      </p>

      {state?.sent ? (
        <p className="mt-8 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-600">
          Falls ein Konto existiert, ist eine E-Mail unterwegs. Prüfe
          dein Postfach.
        </p>
      ) : (
        <form action={action} className="mt-8 space-y-4">
          <Field label="E-Mail">
            <Input name="email" type="email" required />
          </Field>
          {state?.error && (
            <p className="text-[13px] text-danger">{state.error}</p>
          )}
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Link senden"
            )}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Zurück zur Anmeldung
        </Link>
      </p>
    </div>
  );
}
