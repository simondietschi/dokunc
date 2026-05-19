"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, registerAction, type ActionState } from "./actions";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    undefined,
  );

  return (
    <div className="mx-auto mt-24 w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
      <h1 className="mb-1 text-2xl font-bold">dokunc</h1>
      <p className="mb-6 text-sm text-slate-500">
        {mode === "login" ? "Anmelden" : "Konto erstellen"}
      </p>
      <form action={formAction} className="space-y-4">
        {mode === "register" && (
          <Field name="name" label="Name" type="text" />
        )}
        <Field name="email" label="E-Mail" type="email" />
        <Field name="password" label="Passwort" type="password" />
        {state?.error && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-slate-900 py-2 text-white disabled:opacity-50"
        >
          {pending ? "…" : mode === "login" ? "Anmelden" : "Registrieren"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        {mode === "login" ? (
          <>
            Kein Konto?{" "}
            <Link href="/register" className="text-slate-900 underline">
              Registrieren
            </Link>
          </>
        ) : (
          <>
            Schon ein Konto?{" "}
            <Link href="/login" className="text-slate-900 underline">
              Anmelden
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function Field({
  name,
  label,
  type,
}: {
  name: string;
  label: string;
  type: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required
        className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-400"
      />
    </label>
  );
}
