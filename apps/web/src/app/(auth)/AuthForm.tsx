"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { loginAction, registerAction, type ActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    undefined,
  );
  const isLogin = mode === "login";

  return (
    <div>
      <div className="mb-8 lg:hidden">
        <Logo />
      </div>

      <h2 className="text-2xl font-semibold tracking-tight text-ink">
        {isLogin ? "Willkommen zurück" : "Konto erstellen"}
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        {isLogin
          ? "Melde dich an, um weiterzuschreiben."
          : "In wenigen Sekunden startklar."}
      </p>

      <form action={formAction} className="mt-8 space-y-4">
        {!isLogin && (
          <Field label="Name">
            <Input name="name" type="text" placeholder="Alex Muster" required />
          </Field>
        )}
        <Field label="E-Mail">
          <Input
            name="email"
            type="email"
            placeholder="alex@team.de"
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Passwort">
          <Input
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
          />
        </Field>

        {state?.error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger animate-[fade-in_0.2s_ease]">
            {state.error}
          </p>
        )}

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
              {isLogin ? "Anmelden" : "Loslegen"}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {isLogin ? "Noch kein Konto? " : "Schon registriert? "}
        <Link
          href={isLogin ? "/register" : "/login"}
          className="font-medium text-accent hover:underline"
        >
          {isLogin ? "Registrieren" : "Anmelden"}
        </Link>
      </p>
    </div>
  );
}
