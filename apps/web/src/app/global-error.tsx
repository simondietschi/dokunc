"use client";

import { useEffect } from "react";

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
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              background: "#5e60e8",
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
