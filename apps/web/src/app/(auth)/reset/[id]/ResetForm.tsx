"use client";

import { useActionState, useState } from "react";
import { Loader2, LockKeyhole, Eye, EyeOff } from "lucide-react";
import { performResetAction, type ResetState } from "../actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { stagger } from "../../stagger";

export function ResetForm({ id, token }: { id: string; token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    performResetAction,
    undefined,
  );
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div
        className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent-soft"
        style={stagger(0)}
      >
        <LockKeyhole className="h-5 w-5 text-accent" />
      </div>
      <h2
        className="mt-5 text-2xl font-semibold tracking-tight text-ink"
        style={stagger(1)}
      >
        Neues Passwort
      </h2>
      <p className="mt-1.5 text-sm text-muted" style={stagger(2)}>
        Wähle ein neues Passwort (min. 8 Zeichen). Alle anderen
        Sitzungen werden abgemeldet.
      </p>

      <form action={action} className="mt-8 space-y-4">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="token" value={token} />
        <div style={stagger(3)}>
          <span className="mb-1.5 block text-[13px] font-medium text-muted">
            Neues Passwort
          </span>
          <div className="relative">
            <Input
              name="password"
              type={visible ? "text" : "password"}
              placeholder="••••••••"
              autoComplete="new-password"
              autoFocus
              required
              className="pr-11"
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={
                visible ? "Passwort verbergen" : "Passwort anzeigen"
              }
              onClick={() => setVisible((v) => !v)}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors hover:bg-subtle hover:text-ink"
            >
              {visible ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
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
              "Passwort setzen"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
