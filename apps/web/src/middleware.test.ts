import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/**
 * Die CSP der Dokumente, wie die Middleware sie setzt.
 *
 * Frueher gab sie nur bei NODE_ENV === "production" eine CSP aus. In
 * einem Build setzt Next dort fest "production" ein, unter next dev lief
 * die Seite dagegen ganz ohne CSP, und geprueft hat das kein Test. Jetzt
 * gilt: streng in jedem Modus, gelockert nur ausdruecklich in der
 * Entwicklung.
 */

function aufruf(url = "http://localhost:3100/login") {
  return middleware(new NextRequest(url));
}

function direktive(csp: string, name: string) {
  return csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
}

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_COLLAB_URL", ""));
afterEach(() => vi.unstubAllEnvs());

describe("middleware: CSP", () => {
  it.each(["production", "test", undefined, "staging"])(
    "setzt bei NODE_ENV=%s die strenge Fassung mit Nonce",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      const csp = aufruf().headers.get("content-security-policy");
      expect(csp, "Dokumente brauchen eine CSP").toBeTruthy();
      expect(direktive(csp!, "script-src")).toMatch(
        /^script-src 'self' 'nonce-[0-9a-f]{32}' 'strict-dynamic'$/,
      );
      expect(csp).not.toContain("unsafe-eval");
      expect(direktive(csp!, "connect-src")).toBe("connect-src 'self'");
    },
  );

  it("lockert nur bei NODE_ENV=development, fuer Fast Refresh und HMR", () => {
    vi.stubEnv("NODE_ENV", "development");
    const csp = aufruf("http://localhost:3100/s/x").headers.get(
      "content-security-policy",
    )!;
    expect(direktive(csp, "script-src")).toMatch(
      /^script-src 'self' 'nonce-[0-9a-f]{32}' 'strict-dynamic' 'unsafe-eval'$/,
    );
    // Genau der Dev-Server, von dem die Seite kam — nicht jeder Host.
    expect(direktive(csp, "connect-src")).toBe(
      "connect-src 'self' ws://localhost:3100",
    );
  });

  it("reicht dieselbe Nonce an die Seite weiter, die er ausliefert", () => {
    // Next liest die Nonce aus der CSP der ANFRAGE, das Layout aus
    // x-nonce. Weicht eins vom Antwort-Header ab, blockiert der Browser
    // die eigenen Skripte der Seite.
    vi.stubEnv("NODE_ENV", "production");
    const res = aufruf();
    const csp = res.headers.get("content-security-policy")!;
    const nonce = /'nonce-([0-9a-f]{32})'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(
      res.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(csp);
  });

  it("vergibt je Antwort eine neue Nonce", () => {
    const nonce = () =>
      /'nonce-([0-9a-f]{32})'/.exec(
        aufruf().headers.get("content-security-policy") ?? "",
      )?.[1];
    const erste = nonce();
    expect(erste).toBeTruthy();
    expect(nonce()).not.toBe(erste);
  });
});
