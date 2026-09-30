"use client";

import { useUnsentChangesConfirmation } from "./UnsentChangesConfirmation";

/**
 * Abmelden als echter Formularversand an POST /logout: die Antwort kommt
 * als Dokument an, und der Browser verarbeitet Clear-Site-Data (lokale
 * Kopien, HTTP-Cache). Funktioniert auch ohne JavaScript.
 *
 * Hat ein Editor in diesem oder einem anderen Tab Aenderungen, die der
 * Server noch nicht bestaetigt hat, fragt es vorher: beim Abmelden werden
 * alle lokalen Kopien geloescht, und diese Aenderungen gingen verloren
 * (UnsentChangesConfirmation).
 */
export function LogoutForm({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { form, onSubmit, dialog } = useUnsentChangesConfirmation("Abmelden?");
  return (
    <>
      <form ref={form} method="post" action="/logout" className={className} onSubmit={onSubmit}>
        {children}
      </form>
      {dialog}
    </>
  );
}
