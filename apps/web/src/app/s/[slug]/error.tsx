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
      {/* Bewusst nicht error.message: im Produktivbau ersetzt Next die
          Meldung eines Serverfehlers durch einen englischen Rahmenwerks-
          satz, im Client stuende dort die rohe JavaScript-Meldung. Beides
          sagt der lesenden Person nichts. Der echte Fehler steht im
          Effekt oben in der Browserkonsole und im Serverlog. */}
      <p className="mt-1.5 max-w-sm text-sm text-muted">
        Unerwarteter Fehler. Bitte versuche es erneut.
      </p>
      {/* Ohne die Kennung laesst sich der Fall im Serverlog nicht
          wiederfinden, wenn jemand ihn meldet. */}
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-faint">
          Kennung: {error.digest}
        </p>
      )}
      <Button variant="secondary" className="mt-6" onClick={reset}>
        Erneut versuchen
      </Button>
    </div>
  );
}
