import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";

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

/**
 * Content-Security-Policy. 'unsafe-inline' bei script/style ist nötig für
 * den FOUC-freien Theme-Inline-Script und Next/Tailwind-Runtime-Styles.
 * connect-src erlaubt same-origin WSS (Collab über den TLS-Proxy).
 */
const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: wss:",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://embed.diagrams.net",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // HSTS wird am TLS-Edge (Caddy) gesetzt, hier bewusst nicht doppelt.
];

const nextConfig: NextConfig = {
  transpilePackages: ["@dokunc/db", "@dokunc/editor"],
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
      allowedOrigins: ["localhost", ...appUrlHost()],
    },
  },
  async headers() {
    // Strikte Header nur in Produktion (Dev bleibt entwicklerfreundlich,
    // u. a. wegen Collab-WS auf separatem Port).
    if (!isProd) return [];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
