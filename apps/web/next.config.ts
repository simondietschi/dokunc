import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { contentSecurityPolicy } from "./src/lib/csp";

// Monorepo: Root-.env laden, damit web dieselben Variablen wie collab/db nutzt.
loadEnv({ path: new URL("../../.env", import.meta.url).pathname });

const isProd = process.env.NODE_ENV === "production";

function appUrlHost(): string[] {
  try {
    return [new URL(process.env.APP_URL ?? "").host].filter(Boolean);
  } catch {
    return [];
  }
}

// Die Richtlinie selbst steht in src/lib/csp.ts, weil die Middleware
// dieselbe braucht — dort mit Nonce, hier ohne.
const csp = contentSecurityPolicy();

/**
 * Header, die in JEDEM Betriebsmodus mitgehen.
 *
 * Sie kosten in der Entwicklung nichts — keiner von ihnen beeinflusst
 * das Laden von Dev-Ressourcen oder den Collab-WS. Hingen sie wie bisher
 * mit an `isProd`, ginge jede Antwort ohne sie raus, sobald NODE_ENV
 * nicht exakt "production" ist: also in Dev und Test, aber auch bei
 * einem selbst gestarteten Prozess oder einer Staging-Instanz, die die
 * Variable nicht setzt.
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

// Zusätzlich in Produktion: die CSP OHNE Nonce, und nur für /api. Die
// Dokumente bekommen ihre eigene, mit frischer Nonce je Antwort, aus
// src/middleware.ts — ein statischer Header kann das nicht leisten.
// Sie bleibt an isProd gebunden, weil der Collab-WS in der Entwicklung
// auf einem eigenen Port liegt und Next dort Ressourcen nachlädt, die
// 'self' nicht abdeckt.
const apiCspHeader = [{ key: "Content-Security-Policy", value: csp }];

const nextConfig: NextConfig = {
  transpilePackages: ["@dokunc/db", "@dokunc/editor", "@dokunc/mail"],
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
      // "localhost" nur in der Entwicklung erlauben. In Produktion wäre
      // es eine zusätzliche CSRF-Fläche: eine beliebige lokal laufende
      // Seite dürfte sonst Server Actions dieser Instanz auslösen.
      allowedOrigins: isProd ? appUrlHost() : ["localhost", ...appUrlHost()],
    },
  },
  async headers() {
    // Die Grundhärtung gilt immer, die CSP nur in Produktion (Dev bleibt
    // entwicklerfreundlich, u. a. wegen Collab-WS auf separatem Port).
    return [
      { source: "/:path*", headers: baseSecurityHeaders },
      ...(isProd ? [{ source: "/api/:path*", headers: apiCspHeader }] : []),
    ];
  },
};

export default nextConfig;
