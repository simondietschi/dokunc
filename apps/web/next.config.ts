import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { contentSecurityPolicy } from "./src/lib/csp";

// Monorepo: Root-.env laden, damit web dieselben Variablen wie collab/db nutzt.
// fileURLToPath statt `.pathname` (wie in apps/collab/src/env.ts):
// `.pathname` liefert den prozentkodierten URL-Pfad. Liegt das
// Repository in einem Verzeichnis mit Leerzeichen oder Umlaut, bekäme
// dotenv `/home/u/Mein%20Wiki/.env`, fände die Datei nicht und meldete
// das nicht.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

function appUrlHost(): string[] {
  try {
    return [new URL(process.env.APP_URL ?? "").host].filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Header, die in JEDEM Betriebsmodus mitgehen.
 *
 * Sie kosten in der Entwicklung nichts — keiner von ihnen beeinflusst
 * das Laden von Dev-Ressourcen oder den Collab-WS. Hingen sie wie
 * frueher an `NODE_ENV === "production"`, ginge jede Antwort ohne sie
 * raus, sobald NODE_ENV nicht exakt "production" ist: also in Dev und
 * Test, aber auch bei einem selbst gestarteten Prozess oder einer
 * Staging-Instanz, die die Variable nicht setzt.
 */
const baseSecurityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // HSTS wird am TLS-Edge (Caddy) gesetzt, hier bewusst nicht doppelt.
];

/**
 * Die Konfiguration, abhaengig von der Phase, in der Next sie liest.
 *
 * Die Phase entscheidet nur, ob Server Actions zusaetzlich localhost
 * annehmen: allein unter `next dev` (PHASE_DEVELOPMENT_SERVER). Die Phase
 * und nicht NODE_ENV, weil diese Datei zur Laufzeit gelesen wird und
 * nicht im Bundle steht: ein vergessenes oder eigenes NODE_ENV ("test",
 * "staging") entschiede hier sonst anders als in der Middleware. Die
 * Phase setzt Next selbst, und sie trifft genau das, was es in die
 * Middleware fest einsetzt: NODE_ENV ist dort nur unter `next dev`
 * "development" (siehe lib/csp.ts, `cspMode`).
 *
 * Die Header aus `headers()` haengen an keinem von beiden. `next build`
 * berechnet sie einmal und schreibt sie in das Routen-Manifest, mit dem
 * NODE_ENV, das die Build-Shell gerade hat. Mit der alten Bedingung
 * `NODE_ENV === "production"` fehlte die CSP unter /api deshalb in jedem
 * Build, dessen Shell etwa "test" oder "staging" exportierte.
 */
export default function nextConfig(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;

  // Die CSP OHNE Nonce, und nur für /api. Die Dokumente bekommen ihre
  // eigene, mit frischer Nonce je Antwort, aus src/middleware.ts — ein
  // statischer Header kann das nicht leisten.
  //
  // Immer die strenge Fassung, auch unter `next dev`: 'unsafe-eval' und
  // der HMR-Socket dienen Fast Refresh, und das laeuft nur in Dokumenten.
  // Eine API-Antwort laedt keines von beiden; die Lockerung bleibt allein
  // in der Middleware.
  const apiCspHeader = [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(undefined, { mode: "strict" }),
    },
  ];

  return {
    transpilePackages: ["@dokunc/db", "@dokunc/editor", "@dokunc/mail"],
    poweredByHeader: false,
    experimental: {
      serverActions: {
        bodySizeLimit: "5mb",
        // "localhost" nur in der Entwicklung erlauben. Sonst wäre es eine
        // zusätzliche CSRF-Fläche: eine beliebige lokal laufende Seite
        // dürfte Server Actions dieser Instanz auslösen. Dieselbe
        // Bedingung wie für die gelockerte CSP der Middleware (die Phase,
        // s. o.), damit ein vergessenes NODE_ENV nicht still die lockere
        // Seite wählt.
        allowedOrigins: dev ? ["localhost", ...appUrlHost()] : appUrlHost(),
      },
    },
    async headers() {
      // Die Grundhärtung und die strenge CSP für /api gelten in jedem
      // Modus, unabhängig von Phase und NODE_ENV.
      return [
        { source: "/:path*", headers: baseSecurityHeaders },
        { source: "/api/:path*", headers: apiCspHeader },
      ];
    },
  };
}
