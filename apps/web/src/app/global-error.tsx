"use client";

import { useEffect } from "react";
import { ACCENT_COLOR } from "@/lib/brand";

export default function GlobalError({
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
    <html lang="de">
      <body
        style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#fcfcfd",
          color: "#16171b",
        }}
      >
        <div style={{ textAlign: "center", padding: "0 24px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>
            Etwas ist schiefgelaufen
          </h1>
          <p style={{ color: "#6b6f76", marginTop: 8 }}>
            Bitte lade die Seite neu.
          </p>
          {/* Wie in s/[slug]/error.tsx: ohne die Kennung laesst sich der
              Fall im Serverlog nicht wiederfinden, wenn jemand ihn
              meldet. In der Browserkonsole allein sieht sie niemand.
              Farbe wie der Hinweis darueber und nicht blasser, weil die
              Kennung abgelesen und weitergegeben werden soll. */}
          {error.digest && (
            <p
              style={{
                color: "#6b6f76",
                marginTop: 8,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 12,
              }}
            >
              Kennung: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              background: ACCENT_COLOR,
              color: "#fff",
              border: 0,
              borderRadius: 10,
              padding: "9px 18px",
              cursor: "pointer",
            }}
          >
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
