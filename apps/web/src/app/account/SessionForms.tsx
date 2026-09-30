"use client";

import { useActionState, useEffect } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { useUnsentChangesConfirmation } from "@/components/space/UnsentChangesConfirmation";
import { SESSION_ENDED_PATH } from "@/lib/session-end";
import {
  logoutEverywhereAction,
  revokeSessionAction,
  type AccountState,
} from "./actions";

/**
 * Hat eine Action die eigene Sitzung beendet, laedt der Browser
 * /session-ended als Dokument: erst diese Antwort bringt Clear-Site-Data
 * zum Browser (lokale Kopien, HTTP-Cache), dann geht es zur Anmeldung.
 * Eine Umleitung aus der Action holte Next selbst ab.
 */
export function useSessionEndedNavigation(state: AccountState) {
  useEffect(() => {
    if (state?.sitzungBeendet) window.location.assign(SESSION_ENDED_PATH);
  }, [state]);
}

/**
 * "Gerät abmelden" in der Liste der angemeldeten Geräte. Fuer dieses
 * Geraet fragt es nach der Bestaetigung noch einmal, wenn ein Tab
 * ungesendete Aenderungen hat: sie gingen mit den lokalen Kopien verloren.
 */
export function RevokeSessionForm({
  sessionId,
  current,
}: {
  sessionId: string;
  current: boolean;
}) {
  const [state, action] = useActionState<AccountState, FormData>(
    revokeSessionAction,
    undefined,
  );
  useSessionEndedNavigation(state);
  const { form, onSubmit, dialog } = useUnsentChangesConfirmation(
    "Dieses Gerät abmelden?",
    current,
  );
  return (
    <>
      <form ref={form} action={action} onSubmit={onSubmit}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <ConfirmButton
          title="Gerät abmelden"
          message={
            current
              ? "Dieses Gerät abmelden? Du landest wieder auf der Anmeldeseite."
              : "Dieses Gerät abmelden?"
          }
          confirmLabel="Abmelden"
          className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <LogOut className="h-4 w-4" />
        </ConfirmButton>
      </form>
      {dialog}
    </>
  );
}

/**
 * "Überall abmelden": alle Sitzungen dieses Kontos. Fragt vorher, wenn
 * ein Tab dieses Browsers ungesendete Aenderungen hat.
 */
export function LogoutEverywhereForm() {
  const [state, action] = useActionState<AccountState, FormData>(
    logoutEverywhereAction,
    undefined,
  );
  useSessionEndedNavigation(state);
  const { form, onSubmit, dialog } = useUnsentChangesConfirmation("Überall abmelden?");
  return (
    <>
      <form ref={form} action={action} onSubmit={onSubmit} className="mt-4">
        <Button variant="secondary" type="submit">
          Überall abmelden
        </Button>
      </form>
      {dialog}
    </>
  );
}
