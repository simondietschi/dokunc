"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

/**
 * Rückfrage vor einem Zug, der den Schutz einer Seite ändert.
 *
 * Den Text liefert der Server (movePageInSpace) zusammen mit dem Token,
 * das den Zug bestätigt: nur er weiss, über welche Seite die Seite heute
 * geschützt ist und was an der neuen Stelle gilt. Verschieben-Dialog und
 * Seitenbaum zeigen dieselbe Rückfrage, mit derselben Fokusführung.
 *
 * Offen, solange `text` gesetzt ist.
 */
export function ProtectionConfirmDialog({
  text,
  pending = false,
  onConfirm,
  onCancel,
}: {
  text: string | null;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={text !== null}
      onClose={onCancel}
      title="Schutz ändert sich"
      description={text ?? undefined}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={pending}>
            Trotzdem verschieben
          </Button>
        </>
      }
    />
  );
}
