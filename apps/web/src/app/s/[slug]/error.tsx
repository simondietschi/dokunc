"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function SpaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-subtle">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
      </div>
      <h2 className="mt-5 text-lg font-semibold tracking-tight">
        Das hat nicht geklappt
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted">
        {error.message || "Unerwarteter Fehler. Bitte versuche es erneut."}
      </p>
      <Button variant="secondary" className="mt-6" onClick={reset}>
        Erneut versuchen
      </Button>
    </div>
  );
}
