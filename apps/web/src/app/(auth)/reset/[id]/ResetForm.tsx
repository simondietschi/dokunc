"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { performResetAction, type ResetState } from "../actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";

export function ResetForm({ id, token }: { id: string; token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    performResetAction,
    undefined,
  );
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">
        Neues Passwort
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Wähle ein neues Passwort (min. 8 Zeichen).
      </p>
      <form action={action} className="mt-8 space-y-4">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="token" value={token} />
        <Field label="Neues Passwort">
          <Input name="password" type="password" required />
        </Field>
        {state?.error && (
          <p className="text-[13px] text-danger">{state.error}</p>
        )}
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Passwort setzen"
          )}
        </Button>
      </form>
    </div>
  );
}
