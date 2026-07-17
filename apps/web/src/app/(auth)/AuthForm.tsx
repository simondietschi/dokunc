"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";
import { loginAction, registerAction, type ActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";

function PasswordField({
  autoComplete,
}: {
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        name="password"
        type={visible ? "text" : "password"}
        placeholder="••••••••"
        autoComplete={autoComplete}
        required
        className="pr-11"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? "Passwort verbergen" : "Passwort anzeigen"}
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
  );
}

export function AuthForm({
  mode,
  next,
}: {
  mode: "login" | "register";
  next?: string;
}) {
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    undefined,
  );
  const isLogin = mode === "login";
  const switchHref = `${isLogin ? "/register" : "/login"}${
    next ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  const stagger = (i: number) => ({
    animation: "rise 0.5s cubic-bezier(0.22,1,0.36,1) both",
    animationDelay: `${80 + i * 60}ms`,
  });

  return (
    <div>
      <div className="mb-8 lg:hidden">
        <Logo />
      </div>

      <div style={stagger(0)}>
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          {isLogin ? "Willkommen zurück" : "Konto erstellen"}
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          {isLogin
            ? "Melde dich an, um weiterzuschreiben."
            : "Nur per Einladung — das erste Konto wird Admin."}
        </p>
      </div>

      <form action={formAction} className="mt-8 space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        {!isLogin && (
          <div style={stagger(1)}>
            <Field label="Name">
              <Input
                name="name"
                type="text"
                placeholder="Alex Muster"
                autoFocus
                required
              />
            </Field>
          </div>
        )}
        <div style={stagger(2)}>
          <Field label="E-Mail">
            <Input
              name="email"
              type="email"
              placeholder="alex@team.de"
              autoComplete="email"
              autoFocus={isLogin}
              required
            />
          </Field>
        </div>
        <div style={stagger(3)}>
          <div className="flex items-baseline justify-between">
            <span className="mb-1.5 block text-[13px] font-medium text-muted">
              Passwort
            </span>
            {isLogin && (
              <Link
                href="/forgot"
                tabIndex={-1}
                className="text-[12.5px] text-faint transition-colors hover:text-ink"
              >
                Vergessen?
              </Link>
            )}
          </div>
          <PasswordField
            autoComplete={isLogin ? "current-password" : "new-password"}
          />
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
              <>
                {isLogin ? "Anmelden" : "Loslegen"}
                <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
        </div>
      </form>

      <div
        className="mt-8 border-t border-line pt-5 text-center text-sm text-muted"
        style={stagger(5)}
      >
        {isLogin ? "Noch kein Konto? " : "Schon registriert? "}
        <Link
          href={switchHref}
          className="font-medium text-accent hover:underline"
        >
          {isLogin ? "Registrieren" : "Anmelden"}
        </Link>
      </div>
    </div>
  );
}
