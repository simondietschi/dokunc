"use client";

import { useRef } from "react";

/**
 * Button, der vor dem Absenden des umgebenden <form> eine
 * Bestätigung verlangt. Funktioniert mit Server-Action-Forms.
 */
export function ConfirmButton({
  message,
  className,
  title,
  children,
}: {
  message: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      className={className}
      onClick={() => {
        if (window.confirm(message)) {
          ref.current?.closest("form")?.requestSubmit();
        }
      }}
    >
      {children}
    </button>
  );
}
