"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { hasUnsentChanges } from "@/lib/unsent-changes";

/**
 * Abmelden als echter Formularversand an POST /logout: die Antwort kommt
 * als Dokument an, und der Browser verarbeitet Clear-Site-Data (lokale
 * Kopien, HTTP-Cache). Funktioniert auch ohne JavaScript.
 *
 * Hat ein Editor in diesem Tab Aenderungen, die der Server noch nicht
 * bestaetigt hat, fragt es vorher: beim Abmelden werden alle lokalen
 * Kopien geloescht, und diese Aenderungen gingen verloren. Die
 * Bestaetigung steht in einer Ref: requestSubmit() loest das zweite
 * submit synchron aus, ein State saehe dort noch den alten Wert.
 */
export function LogoutForm({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const bestaetigt = useRef(false);
  const [fragen, setFragen] = useState(false);

  return (
    <>
      <form
        ref={form}
        method="post"
        action="/logout"
        className={className}
        onSubmit={(e) => {
          if (bestaetigt.current || !hasUnsentChanges()) return;
          e.preventDefault();
          setFragen(true);
        }}
      >
        {children}
      </form>
      <Dialog
        open={fragen}
        onClose={() => setFragen(false)}
        title="Abmelden?"
        description="In diesem Tab gibt es Änderungen, die der Server noch nicht bestätigt hat. Beim Abmelden werden sie auf diesem Gerät gelöscht und gehen verloren."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setFragen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="border border-danger/30 bg-danger/10 hover:bg-danger/20"
              onClick={() => {
                bestaetigt.current = true;
                setFragen(false);
                form.current?.requestSubmit();
              }}
            >
              Trotzdem abmelden
            </Button>
          </>
        }
      />
    </>
  );
}
