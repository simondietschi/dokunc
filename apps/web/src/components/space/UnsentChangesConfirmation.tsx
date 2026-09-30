"use client";

import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { hasUnsentChangesAnywhere } from "@/lib/unsent-changes";

/** Text der Rueckfrage: fuer alle Wege, die die eigene Sitzung beenden. */
export const UNSENT_CHANGES_WARNING =
  "In einem geöffneten Tab gibt es Änderungen, die der Server noch nicht bestätigt hat. Beim Abmelden werden sie auf diesem Gerät gelöscht und gehen verloren.";

/**
 * Rueckfrage vor einem Formular, das die eigene Sitzung beendet
 * (Abmelden, "Gerät abmelden" fuer dieses Geraet, "Überall abmelden"):
 * danach werden alle lokalen Kopien geloescht, und was der Server noch
 * nicht bestaetigt hat, ginge verloren.
 *
 * `onSubmit` haelt das Absenden an und fragt die Editoren in diesem und
 * in anderen Tabs (lib/unsent-changes, hoechstens 300 ms). Ohne
 * Ungesendetes sendet es ab, sonst zeigt `dialog` die Rueckfrage. Die
 * Bestaetigung steht in einer Ref: requestSubmit() loest das zweite
 * submit synchron aus, ein State saehe dort noch den alten Wert. Danach
 * gilt sie nicht mehr: scheitert eine Action, fragt der naechste Versuch
 * wieder. Ohne JavaScript sendet das Formular ohne Rueckfrage, ebenso mit
 * `aktiv = false`.
 */
export function useUnsentChangesConfirmation(
  titel: string,
  aktiv = true,
): {
  form: RefObject<HTMLFormElement | null>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  dialog: ReactNode;
} {
  const form = useRef<HTMLFormElement>(null);
  const bestaetigt = useRef(false);
  const pruefung = useRef(false);
  const [fragen, setFragen] = useState(false);

  const absenden = () => {
    bestaetigt.current = true;
    try {
      form.current?.requestSubmit();
    } finally {
      bestaetigt.current = false;
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!aktiv || bestaetigt.current) return;
    e.preventDefault();
    if (pruefung.current) return;
    pruefung.current = true;
    void hasUnsentChangesAnywhere().then((ungesendet) => {
      pruefung.current = false;
      if (ungesendet) setFragen(true);
      else absenden();
    });
  };

  const dialog = (
    <Dialog
      open={fragen}
      onClose={() => setFragen(false)}
      title={titel}
      description={UNSENT_CHANGES_WARNING}
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
              setFragen(false);
              absenden();
            }}
          >
            Trotzdem abmelden
          </Button>
        </>
      }
    />
  );

  return { form, onSubmit, dialog };
}
