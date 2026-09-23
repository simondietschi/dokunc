"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { useModal } from "./use-modal";
import { closeIntent } from "@/lib/modal-keys";

/**
 * Vollbild-Fenster fuer die Zeichen-Editoren (Excalidraw, draw.io).
 *
 * Vorher bauten beide ihr Geruest selbst: ein nacktes `div` ohne
 * role="dialog" und aria-modal, ohne Namen, ohne Escape, ohne
 * Fokusfuehrung und Scroll-Sperre. Das kommt jetzt wie bei allen anderen
 * Modalen aus `useModal`.
 *
 * Schliessen ohne Uebernehmen laeuft ueber genau EINEN Weg,
 * `requestClose`: den nimmt der Knopf "Abbrechen" und den nimmt Escape.
 * Frueher verwarf der Knopf ohne Rueckfrage; haette Escape dasselbe
 * getan, waere ein Tastendruck zu viel (zweimal Escape: Werkzeug
 * abwaehlen, Fenster zu) die ganze Zeichnung gewesen. Deshalb fragt
 * `requestClose` nach, sobald es ungesicherte Aenderungen gibt, und
 * zwar fuer Knopf und Taste gleich.
 *
 * Escape schliesst ausserdem nur aus dem eigenen Rahmen: aus der
 * Zeichenflaeche (`surface`) nie, und nie, wenn der Editor die Taste
 * schon benutzt hat (siehe lib/modal-keys `escapeCloses`). draw.io
 * laeuft in einem iframe fremder Herkunft; Tasten dort erreichen dieses
 * Dokument gar nicht.
 */
export function FullscreenDialog({
  title,
  description,
  actions,
  children,
  onCancel,
  hasUnsavedChanges,
  surface,
}: {
  /** Sichtbare Ueberschrift, zugleich der Name des Dialogs. */
  title: string;
  description?: string;
  /** Weitere Knoepfe rechts neben "Abbrechen", etwa "Übernehmen". */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Schliessen und verwerfen, was nicht uebernommen ist. */
  onCancel: () => void;
  /**
   * Gibt es Aenderungen, die beim Schliessen verloren gingen? Wird erst
   * beim Schliessversuch gefragt, nicht bei jedem Strich.
   */
  hasUnsavedChanges: () => boolean;
  /** Zeichenflaeche mit eigener Tastaturbedienung (siehe useModal). */
  surface?: (el: Element) => boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const weiter = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const [fragen, setFragen] = useState(false);

  // Entscheidung in lib/modal-keys (`closeIntent`), hier nur ausgefuehrt.
  function requestClose() {
    if (closeIntent(hasUnsavedChanges()) === "ask") setFragen(true);
    else onCancel();
  }

  // Ohne Warten auf `mounted`: das Fenster entsteht erst auf einen Klick
  // im Editor, nie beim Server-Rendern. Das Geruest muss schon im ersten
  // Commit stehen, sonst findet useModal beim Oeffnen nichts, worauf es
  // den Fokus setzen kann.
  useModal({ open: true, onClose: requestClose, panel, surface });

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      tabIndex={-1}
      className="fixed inset-0 z-modal flex flex-col bg-canvas outline-none"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id={titleId} className="shrink-0 text-sm font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descId} className="truncate text-sm text-faint">
              {description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={requestClose}>
            Abbrechen
          </Button>
          {actions}
        </div>
      </div>
      {children}

      <Dialog
        open={fragen}
        onClose={() => setFragen(false)}
        title="Änderungen verwerfen?"
        description="Was seit dem Öffnen gezeichnet wurde, ist noch nicht übernommen und geht beim Verwerfen verloren."
        initialFocus={weiter}
        footer={
          <>
            <Button
              ref={weiter}
              variant="secondary"
              size="sm"
              onClick={() => setFragen(false)}
            >
              Weiter bearbeiten
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="border border-danger/30 bg-danger/10 hover:bg-danger/20"
              onClick={() => {
                setFragen(false);
                onCancel();
              }}
            >
              Verwerfen
            </Button>
          </>
        }
      />
    </div>,
    document.body,
  );
}
