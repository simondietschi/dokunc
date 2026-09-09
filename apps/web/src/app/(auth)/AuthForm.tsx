"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { loginAction, registerAction, type ActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { stagger } from "./stagger";

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

/** Fehlgeschlagene SSO-Anmeldungen, in Klartext übersetzt. */
const SSO_ERRORS: Record<string, string> = {
  disabled: "Single Sign-on ist auf dieser Instanz nicht eingerichtet.",
  throttled: "Zu viele Anläufe. Bitte kurz warten.",
  expired: "Der Anmeldevorgang ist abgelaufen. Bitte neu beginnen.",
  denied: "Der Anbieter hat die Anmeldung abgelehnt.",
  state: "Der Anmeldevorgang passt nicht zusammen. Bitte neu beginnen.",
  error: "Die Anmeldung über den Anbieter hat nicht geklappt.",
  no_email: "Der Anbieter hat keine E-Mail-Adresse mitgeschickt.",
  unverified:
    "Der Anbieter meldet die E-Mail-Adresse als unbestätigt. " +
    "Eine unbestätigte Adresse kann kein Konto übernehmen.",
  linked_elsewhere:
    "Zu dieser E-Mail gehört bereits ein anderes SSO-Konto.",
  no_link:
    "Diese Instanz verknüpft bestehende Konten nicht automatisch über " +
    "die E-Mail-Adresse. Bitte die Administration um die Verknüpfung.",
  admin_link:
    "Ein Konto mit Verwaltungsrechten wird nicht automatisch verknüpft. " +
    "Bitte die Administration ansprechen.",
  inactive: "Dieses Konto ist deaktiviert.",
  no_account:
    "Für diese Person gibt es hier kein Konto. Diese Instanz legt " +
    "keine Konten über SSO an — bitte um eine Einladung bitten.",
};

export function AuthForm({
  mode,
  next,
  sso,
  ssoError,
}: {
  mode: "login" | "register";
  next?: string;
  /** Beschriftung der SSO-Schaltfläche, null = nicht eingerichtet. */
  sso?: string | null;
  ssoError?: string;
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

      {/* Die Meldung steht ausserhalb der Schaltfläche: schlägt die
          Anmeldung fehl, weil gar kein Anbieter eingerichtet ist, gibt
          es keine Schaltfläche — die Erklärung braucht es trotzdem. */}
      {isLogin && ssoError && SSO_ERRORS[ssoError] && (
        <p
          style={stagger(1)}
          className="dk-shake mt-6 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          {SSO_ERRORS[ssoError]}
        </p>
      )}

      {sso && isLogin && (
        <div className="mt-6" style={stagger(1)}>
          <a
            href={`/api/auth/oidc/start${
              next ? `?next=${encodeURIComponent(next)}` : ""
            }`}
            className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-5 text-[15px] font-medium text-ink transition-colors hover:bg-subtle"
          >
            <KeyRound className="h-4 w-4 text-muted" />
            Weiter mit {sso}
          </a>
          <div className="mt-5 flex items-center gap-3 text-[12.5px] text-faint">
            <span className="h-px flex-1 bg-line" />
            oder mit E-Mail
            <span className="h-px flex-1 bg-line" />
          </div>
        </div>
      )}

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

        {isLogin && (
          <label
            style={stagger(3)}
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
        )}

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
