"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Das Verhalten eines modalen Fensters an einer Stelle.
 *
 * Vier Stellen bauten es sich selbst: `ui/Dialog`, `CommandPalette`,
 * `MovePageDialog` und `TemplatePicker`. Keine zwei gleich, und jede
 * vergass etwas anderes:
 *
 * - MovePageDialog gab den Fokus beim Schliessen nicht zurueck, und
 *   seine Liste der fokussierbaren Elemente kannte weder Links noch
 *   Textfelder noch Auswahlfelder.
 * - TemplatePicker hatte weder Fokusfalle noch Scroll-Sperre: Tab lief
 *   aus dem Dialog heraus, der Hintergrund scrollte mit.
 * - CommandPalette hoerte auf Escape nur im Suchfeld; wer in der Liste
 *   stand, kam mit der Taste nicht heraus, und eine Fokusfalle gab es
 *   ebenfalls nicht.
 *
 * Gemeinsam ist: Fokus hinein und beim Schliessen zurueck, Tab bleibt
 * drin, Escape schliesst, der Hintergrund scrollt nicht mit. Das Aussehen
 * ist es nicht — deshalb gibt der Haken nur Verhalten heraus und laesst
 * jedem Aufrufer sein eigenes Geruest.
 */

/** Was in einem Dialog den Fokus bekommen kann. */
export const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Offene Modale in Oeffnungsreihenfolge.
 *
 * Nur das oberste hoert auf Tasten. Ohne diesen Stapel schliesst ein
 * Escape in einem Dialog, der aus einem anderen heraus geoeffnet wurde,
 * beide auf einmal — der Tastendruck liegt am `document`, und dort
 * haengen dann zwei Zuhoerer.
 */
const offen: symbol[] = [];

/** Scroll-Sperre: setzen, wenn das erste Modal aufgeht, loesen beim letzten. */
let vorherigesOverflow: string | null = null;

function sperreHintergrund(id: symbol): () => void {
  if (offen.length === 0) {
    vorherigesOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  offen.push(id);
  return () => {
    const i = offen.indexOf(id);
    if (i !== -1) offen.splice(i, 1);
    if (offen.length === 0 && vorherigesOverflow !== null) {
      document.body.style.overflow = vorherigesOverflow;
      vorherigesOverflow = null;
    }
  };
}

type Optionen = {
  /** Ist das Modal gerade offen? */
  open: boolean;
  /** Wird bei Escape und (falls der Aufrufer will) beim Hintergrundklick gerufen. */
  onClose: () => void;
  /** Das Geruest, in dem der Fokus bleiben soll. */
  panel: React.RefObject<HTMLElement | null>;
  /** Element, das beim Oeffnen den Fokus bekommt. Ohne Angabe das erste im Geruest. */
  initialFocus?: React.RefObject<HTMLElement | null>;
};

/**
 * Gibt `mounted` zurueck: erst danach darf in ein Portal gerendert
 * werden, sonst weicht der erste Client-Baum vom Server ab.
 */
export function useModal({ open, onClose, panel, initialFocus }: Optionen) {
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Fokus setzen, Hintergrund sperren, beides beim Schliessen zuruecknehmen.
  useEffect(() => {
    if (!open) return;
    const id = Symbol("modal");
    const zurueckAn = document.activeElement as HTMLElement | null;
    const entsperre = sperreHintergrund(id);

    const ziel =
      initialFocus?.current ??
      panel.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel.current;
    // Nach dem Paint, sonst greift der Fokus ins Leere.
    const raf = requestAnimationFrame(() => ziel?.focus());

    const onKey = (e: KeyboardEvent) => {
      // Nur das oberste Modal reagiert.
      if (offen[offen.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const elemente = Array.from(
        panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (elemente.length === 0) return;
      const erstes = elemente[0];
      const letztes = elemente[elemente.length - 1];
      const aktiv = document.activeElement;
      const drin = panel.current.contains(aktiv);
      if (e.shiftKey && (aktiv === erstes || !drin)) {
        e.preventDefault();
        letztes.focus();
      } else if (!e.shiftKey && (aktiv === letztes || !drin)) {
        e.preventDefault();
        erstes.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      entsperre();
      zurueckAn?.focus?.();
    };
  }, [open, panel, initialFocus]);

  return { mounted };
}

/**
 * Klick auf den Hintergrund schliesst, Klick im Geruest nicht.
 *
 * Als eigener Helfer, weil die vier Aufrufer es verschieden geloest
 * haben — mal `onClick` auf der Huelle plus `stopPropagation` im
 * Geruest, mal `onMouseDown`. Der Unterschied ist spuerbar: wer im
 * Geruest die Maustaste drueckt und ueber dem Hintergrund loslaesst
 * (Text markieren), schliesst mit `onClick` den Dialog ungewollt.
 */
export function useBackdropClose(
  panel: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  // Ohne useCallback: der React-Compiler haelt die Funktion selbst
  // stabil, und ein handgeschriebenes Memo mit einem Ref in den
  // Abhaengigkeiten kann er nicht uebernehmen.
  return (e: React.MouseEvent) => {
    if (!panel.current?.contains(e.target as Node)) onClose();
  };
}
