import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_EXPORT,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
  PHASE_TEST,
} from "next/constants";
import { normalizeConfig } from "next/dist/server/config-shared";
import { contentSecurityPolicy } from "./lib/csp";

/**
 * Die Header aus next.config.ts, so wie Next sie liest.
 *
 * Die Grundhaertung prueft bisher kein Test, die CSP nur fuer Dokumente
 * und nur im E2E-Lauf gegen einen Build mit NODE_ENV=production — genau
 * der eine Fall, in dem schon die alte Bedingung stimmte. Hier laufen
 * alle Phasen gegen alle Werte von NODE_ENV, weil der Befund B148 in den
 * anderen lag: eine Build-Shell mit NODE_ENV=test oder ganz ohne schrieb
 * /api ohne CSP ins Manifest.
 */

type Regel = { source: string; headers: { key: string; value: string }[] };

const PHASEN_OHNE_DEV = [
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
  PHASE_EXPORT,
  PHASE_TEST,
];
const ALLE_PHASEN = [PHASE_DEVELOPMENT_SERVER, ...PHASEN_OHNE_DEV];
const NODE_ENVS = ["production", "development", "test", undefined, "staging"];

/**
 * Laedt next.config.ts frisch, mit gesetztem NODE_ENV, und loest den
 * Export ueber Nexts eigene Funktion auf — die nimmt ein Objekt ebenso
 * an wie eine Funktion der Phase. Frisch, weil die Datei beim Laden
 * Umgebung liest; ein zwischengespeichertes Modul truege den Wert des
 * vorigen Falls weiter.
 */
async function laden(
  phase: string,
  nodeEnv: string | undefined,
): Promise<NextConfig> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  const mod = await import("../next.config");
  return (await normalizeConfig(phase, mod.default)) as NextConfig;
}

async function regeln(phase: string, nodeEnv: string | undefined) {
  const config = await laden(phase, nodeEnv);
  return ((await config.headers?.()) ?? []) as Regel[];
}

function header(liste: Regel[], source: string, key: string) {
  return liste
    .find((r) => r.source === source)
    ?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

beforeEach(() => {
  // next.config.ts laedt die Root-.env; ohne das hier schriebe dotenv bei
  // jedem frischen Laden eine Zeile in die Ausgabe.
  vi.stubEnv("DOTENV_CONFIG_QUIET", "true");
  // Die Collab-Adresse aendert connect-src und ist hier nicht Thema.
  vi.stubEnv("NEXT_PUBLIC_COLLAB_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("next.config.ts: Header", () => {
  it("liefert die Grundhaertung in jeder Phase und bei jedem NODE_ENV", async () => {
    for (const phase of ALLE_PHASEN) {
      for (const nodeEnv of NODE_ENVS) {
        const r = await regeln(phase, nodeEnv);
        const fall = `${phase} / NODE_ENV=${nodeEnv}`;
        expect(header(r, "/:path*", "X-Frame-Options"), fall).toBe("DENY");
        expect(header(r, "/:path*", "X-Content-Type-Options"), fall).toBe(
          "nosniff",
        );
        expect(header(r, "/:path*", "Referrer-Policy"), fall).toBe(
          "strict-origin-when-cross-origin",
        );
        expect(header(r, "/:path*", "Permissions-Policy"), fall).toBe(
          "camera=(), microphone=(), geolocation=()",
        );
      }
    }
  });

  it("liefert fuer /api in jeder Phase und bei jedem NODE_ENV eine CSP", async () => {
    for (const phase of ALLE_PHASEN) {
      for (const nodeEnv of NODE_ENVS) {
        const csp = header(
          await regeln(phase, nodeEnv),
          "/api/:path*",
          "Content-Security-Policy",
        );
        const fall = `${phase} / NODE_ENV=${nodeEnv}`;
        expect(csp, fall).toBeTruthy();
        expect(csp, fall).toContain("frame-ancestors 'none'");
        expect(csp, fall).toContain("object-src 'none'");
      }
    }
  });

  it("liefert fuer /api immer die strenge CSP, auch unter next dev", async () => {
    // Die Lockerung ('unsafe-eval', HMR-Socket) dient Fast Refresh, und
    // das laeuft nur in Dokumenten; die bekommen ihre CSP aus der
    // Middleware (middleware.test.ts prueft dort die Dev-Fassung). Eine
    // API-Antwort braucht keins von beiden. Auch ein Build aus einer
    // Shell mit NODE_ENV=development bleibt streng.
    const streng = contentSecurityPolicy(undefined, { mode: "strict" });
    for (const phase of ALLE_PHASEN) {
      for (const nodeEnv of NODE_ENVS) {
        const csp = header(
          await regeln(phase, nodeEnv),
          "/api/:path*",
          "Content-Security-Policy",
        );
        const fall = `${phase} / NODE_ENV=${nodeEnv}`;
        expect(csp, fall).not.toContain("unsafe-eval");
        expect(csp, fall).toBe(streng);
      }
    }
  });
});

describe("next.config.ts: Server Actions", () => {
  beforeEach(() => vi.stubEnv("APP_URL", "https://wiki.example.com"));

  it("nimmt localhost nur unter next dev zusaetzlich an", async () => {
    // Dieselbe Bedingung wie fuer die gelockerte CSP der Middleware:
    // sonst waehlte ein vergessenes NODE_ENV still die lockere Seite, und
    // jede lokal laufende Seite duerfte Server Actions dieser Instanz
    // ausloesen.
    for (const phase of PHASEN_OHNE_DEV) {
      for (const nodeEnv of NODE_ENVS) {
        const config = await laden(phase, nodeEnv);
        expect(
          config.experimental?.serverActions?.allowedOrigins,
          `${phase} / NODE_ENV=${nodeEnv}`,
        ).toEqual(["wiki.example.com"]);
      }
    }
    const dev = await laden(PHASE_DEVELOPMENT_SERVER, "development");
    expect(dev.experimental?.serverActions?.allowedOrigins).toEqual([
      "localhost",
      "wiki.example.com",
    ]);
  });
});
