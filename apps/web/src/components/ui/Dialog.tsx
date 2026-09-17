"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useBackdropClose, useModal } from "./use-modal";

/**
 * Modaler Dialog: Titel, Beschreibung, Inhalt, Fussleiste.
 *
 * Fokusfalle, Escape, Scroll-Sperre und Fokus-Rückgabe kommen aus
 * `useModal` — dieselben vier Dinge brauchen auch Palette, Verschiebe-
 * Dialog und Vorlagenauswahl, die nicht in dieses Layout passen.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocus,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Element, das beim Öffnen den Fokus bekommt. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const { mounted } = useModal({ open, onClose, panel, initialFocus });
  const onBackdrop = useBackdropClose(panel, onClose);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center p-4"
      onMouseDown={onBackdrop}
    >
      <div
        className="absolute inset-0 animate-[fade-in_0.15s_ease] bg-ink/25 backdrop-blur-[2px]"
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-md animate-[rise_0.2s_cubic-bezier(0.22,1,0.36,1)_both] rounded-2xl border border-line bg-elevated p-5 shadow-pop focus:outline-none",
          className,
        )}
      >
        <h2 id={titleId} className="text-[15px] font-semibold tracking-tight">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-1 text-[13px] leading-snug text-muted">
            {description}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
        {footer && (
          <div className="mt-5 flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
