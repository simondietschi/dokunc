"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { completeTotpLoginAction, type ActionState } from "../../actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { stagger } from "../../stagger";

export function TotpForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    completeTotpLoginAction,
    undefined,
  );
  const [recovery, setRecovery] = useState(false);

  return (
    <div>
      <div style={stagger(0)}>
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          Bestätigung
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          {recovery
            ? "Gib einen deiner Wiederherstellungscodes ein."
            : "Gib den sechsstelligen Code aus deiner Authenticator-App ein."}
        </p>
      </div>

      <form action={action} className="mt-8 space-y-4">
        <div style={stagger(1)}>
          <Input
            // Der Schlüssel wechselt mit dem Modus, damit React ein
            // frisches Feld baut statt den alten Wert zu behalten.
            key={recovery ? "recovery" : "totp"}
            name="code"
            autoFocus
            required
            autoComplete="one-time-code"
            inputMode={recovery ? "text" : "numeric"}
            placeholder={recovery ? "0123456789-abcdef0123" : "123456"}
            aria-label={recovery ? "Wiederherstellungscode" : "Einmalcode"}
            className={
              recovery
                ? "text-center font-mono tracking-[0.2em]"
                : "text-center font-mono text-lg tracking-[0.5em]"
            }
          />
        </div>

        <label
          style={stagger(2)}
          className="flex cursor-pointer items-center gap-2 text-[13px] text-muted"
        >
          <input
            type="checkbox"
            name="remember"
            defaultChecked
            className="h-3.5 w-3.5 rounded border-line-strong accent-[var(--accent)]"
          />
          Angemeldet bleiben
        </label>

        {state?.error && (
          <p className="dk-shake rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </p>
        )}

        <div style={stagger(3)}>
          <Button
            type="submit"
            size="lg"
            disabled={pending}
            className="w-full"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Anmelden
                <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
        </div>
      </form>

      <button
        type="button"
        onClick={() => setRecovery((v) => !v)}
        style={stagger(4)}
        className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
      >
        <KeyRound className="h-3.5 w-3.5" />
        {recovery
          ? "Doch die Authenticator-App verwenden"
          : "Kein Zugriff auf die App? Wiederherstellungscode verwenden"}
      </button>

      <div
        className="mt-8 border-t border-line pt-5 text-center text-sm text-muted"
        style={stagger(5)}
      >
        <Link href="/login" className="font-medium text-accent hover:underline">
          Zurück zur Anmeldung
        </Link>
      </div>
    </div>
  );
}
