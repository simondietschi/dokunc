"use client";

import { useFormStatus } from "react-dom";
import { Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Absendeknopf "Wiederherstellen" der Verlaufsseiten, in einem <form>
 * mit restoreVersionAction.
 *
 * Die Aktion wartet auf die Quittung des Collab-Servers, dass offene
 * Editoren den Stand uebernommen haben: im Normalfall Millisekunden,
 * ohne Antwort bis zu DOC_RESET_ACK_TIMEOUT_MS (5 s) plus einer halben
 * Sekunde Reserve. Ein nackter Knopf zeigte in dieser Zeit nichts; wer
 * ungeduldig nochmals klickte, loeste die Wiederherstellung ein zweites
 * Mal aus. Deshalb ist er gesperrt, solange das Formular unterwegs ist,
 * und sagt, dass er arbeitet.
 */
export function RestoreButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const Icon = pending ? Loader2 : RotateCcw;
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(className, "disabled:cursor-wait disabled:opacity-70")}
    >
      <Icon
        aria-hidden="true"
        className={cn("h-3.5 w-3.5", pending && "animate-spin")}
      />
      {pending ? "Wird wiederhergestellt…" : children}
    </button>
  );
}
