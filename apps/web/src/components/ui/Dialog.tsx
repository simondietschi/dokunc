"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modaler Dialog mit Fokusfalle, Escape, Scroll-Sperre und
 * Fokus-Rückgabe an das auslösende Element.
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
  const restoreTo = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => setMounted(true), []);

  // Fokus fangen und beim Schliessen zurückgeben.
  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const target =
      initialFocus?.current ??
      panel.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel.current;
    // Nach dem Paint fokussieren, sonst greift der Fokus ins Leere.
    const raf = requestAnimationFrame(() => target?.focus());

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, initialFocus]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center p-4"
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 animate-[fade-in_0.15s_ease] bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
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
