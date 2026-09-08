"use client";

import { useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

/**
 * Button, der vor dem Absenden des umgebenden <form> eine Bestätigung
 * verlangt. Nutzt einen echten Dialog (kein window.confirm), damit
 * Aussehen, Fokusführung und Screenreader-Ansage zum Rest der App passen.
 */
export function ConfirmButton({
  message,
  className,
  title,
  confirmLabel = "Ja, fortfahren",
  destructive = true,
  children,
}: {
  message: string;
  className?: string;
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={ref}
        type="button"
        title={title}
        className={className}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title ?? "Bestätigen"}
        description={message}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Abbrechen
            </Button>
            <Button
              variant={destructive ? "danger" : "primary"}
              size="sm"
              className={
                destructive
                  ? "border border-danger/30 bg-danger/10 hover:bg-danger/20"
                  : undefined
              }
              onClick={() => {
                setOpen(false);
                ref.current?.closest("form")?.requestSubmit();
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      />
    </>
  );
}
