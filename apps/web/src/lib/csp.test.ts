import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collabOrigin,
  contentSecurityPolicy,
  createNonce,
  cspMode,
  devServerSocket,
} from "./csp";

// collabOrigin() und damit connect-src lesen NEXT_PUBLIC_COLLAB_URL aus
// der Umgebung, wenn kein Wert uebergeben wird. Die Root-.env setzt sie
// fuer die Entwicklung; ohne den Stub hinge das Ergebnis daran, ob die
// Shell sie geladen hat, und "nichts konfiguriert" liesse sich gar nicht
// pruefen. Tests, die eine Adresse brauchen, uebergeben sie ausdruecklich.
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_COLLAB_URL", ""));
afterEach(() => vi.unstubAllEnvs());

/** Holt eine Direktive aus dem zusammengesetzten Header-Wert. */
function direktive(csp: string, name: string): string {
  const treffer = csp
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!treffer) throw new Error(`Direktive ${name} fehlt`);
  return treffer;
}

describe("contentSecurityPolicy()", () => {
  it("erlaubt ohne Nonce weiterhin Inline-Skripte", () => {
    // Das ist der Stand fuer /api: dort laeuft keine Middleware, die
    // eine Nonce vergeben koennte.
    expect(direktive(contentSecurityPolicy(), "script-src")).toBe(
      "script-src 'self' 'unsafe-inline'",
    );
  });

  it("ersetzt 'unsafe-inline' durch die Nonce, sobald es eine gibt", () => {
    // Der Kern des Befunds: mit 'unsafe-inline' ist genau das erlaubt,
    // wogegen die CSP schuetzen soll. Beides nebeneinander waere
    // ebenfalls wirkungslos — Browser ignorieren 'unsafe-inline', sobald
    // eine Nonce dasteht, aber wer die Zeile liest, soll es sehen.
    const script = direktive(contentSecurityPolicy("abc123"), "script-src");
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
  });

  it("laesst Stile inline, weil eine Nonce sie nicht erreicht", () => {
    for (const csp of [contentSecurityPolicy(), contentSecurityPolicy("x")]) {
      expect(direktive(csp, "style-src")).toContain("'unsafe-inline'");
    }
  });

  it("haelt die uebrigen Direktiven unabhaengig von der Nonce gleich", () => {
    const ohne = contentSecurityPolicy().split("; ");
    const mit = contentSecurityPolicy("x").split("; ");
    const nurScript = (d: string[]) => d.filter((x) => !x.startsWith("script-src"));
    expect(nurScript(mit)).toEqual(nurScript(ohne));
    expect(direktive(contentSecurityPolicy(), "object-src")).toBe(
      "object-src 'none'",
    );
    expect(direktive(contentSecurityPolicy(), "frame-ancestors")).toBe(
      "frame-ancestors 'none'",
    );
  });
});

describe("cspMode()", () => {
  it("lockert nur bei ausdruecklichem development", () => {
    expect(cspMode("development")).toBe("development");
  });

  it("waehlt fuer alles andere die strenge Fassung", () => {
    // Der Kern von B148: frueher hing die CSP an "production", und eine
    // Instanz mit test, staging oder ganz ohne NODE_ENV lief ohne. Jetzt
    // muss die Lockerung ausdruecklich verlangt werden; ein vergessener
    // oder vertippter Wert faellt auf die sichere Seite.
    for (const wert of ["production", "test", undefined, "", "staging", "dev"]) {
      expect(cspMode(wert), String(wert)).toBe("strict");
    }
  });
});

describe("contentSecurityPolicy() je Fassung", () => {
  it("liefert ohne Angabe die strenge Fassung", () => {
    expect(contentSecurityPolicy("n")).toBe(
      contentSecurityPolicy("n", { mode: "strict" }),
    );
    expect(contentSecurityPolicy()).toBe(
      contentSecurityPolicy(undefined, { mode: "strict" }),
    );
  });

  it("gibt streng weder eval noch einen Dev-Socket frei", () => {
    // Auch dann nicht, wenn die Middleware einen Dev-Server mitgibt: das
    // tut sie in jedem Modus, entscheiden soll allein die Fassung.
    for (const nonce of ["n", undefined]) {
      const csp = contentSecurityPolicy(nonce, {
        mode: "strict",
        devServer: "http://localhost:3000",
      });
      expect(csp).not.toContain("unsafe-eval");
      expect(direktive(csp, "connect-src")).toBe("connect-src 'self'");
    }
  });

  it("gibt in der Entwicklung eval und genau den Dev-Server frei", () => {
    const csp = contentSecurityPolicy("n", {
      mode: "development",
      devServer: "http://localhost:3100",
    });
    expect(direktive(csp, "script-src")).toBe(
      "script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'",
    );
    expect(direktive(csp, "connect-src")).toBe(
      "connect-src 'self' ws://localhost:3100",
    );
    // Nie das blanke Schema: das gaebe jeden Host frei.
    expect(csp.split(/[ ;]+/)).not.toContain("ws:");
  });

  it("aendert in der Entwicklung nur script-src und connect-src", () => {
    // Nonce, strict-dynamic und alle Ziele bleiben, damit ein Verstoss
    // gegen die Richtlinie schon unter next dev auffaellt.
    const streng = contentSecurityPolicy("n").split("; ");
    const dev = contentSecurityPolicy("n", {
      mode: "development",
      devServer: "http://localhost:3100",
    }).split("; ");
    const ohne = (d: string[]) =>
      d.filter((x) => !/^(script|connect)-src /.test(x));
    expect(ohne(dev)).toEqual(ohne(streng));
    expect(direktive(dev.join("; "), "script-src")).toContain("'nonce-n'");
  });

  it("gibt ohne Dev-Server auch in der Entwicklung keinen Socket frei", () => {
    // Ohne Ursprung gibt es keinen Host, den die Fassung freigeben
    // koennte. Sie raet dann nicht und greift auch nicht zum blanken
    // Schema, sondern laesst connect-src bei 'self'.
    const csp = contentSecurityPolicy(undefined, { mode: "development" });
    expect(direktive(csp, "script-src")).toBe(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(direktive(csp, "connect-src")).toBe("connect-src 'self'");
  });
});

describe("devServerSocket()", () => {
  it("leitet ws bzw. wss aus dem Ursprung der Seite ab", () => {
    expect(devServerSocket("http://localhost:3000")).toEqual([
      "ws://localhost:3000",
    ]);
    expect(devServerSocket("https://dev.example.com/login?x=1")).toEqual([
      "wss://dev.example.com",
    ]);
  });

  it("gibt bei fehlender oder unbrauchbarer Adresse nichts frei", () => {
    for (const wert of [undefined, "", "kein-url", "ftp://localhost:21"]) {
      expect(devServerSocket(wert), String(wert)).toEqual([]);
    }
  });
});

describe("collabOrigin()", () => {
  it("gibt nichts zurueck, wenn nichts konfiguriert ist", () => {
    // Dann liegt der Endpunkt same-origin unter /collab, und 'self'
    // deckt ihn ab.
    for (const wert of ["", "   ", undefined]) {
      expect(collabOrigin(wert)).toEqual([]);
    }
  });

  it("gibt genau den Ursprung frei, nicht das Schema", () => {
    // Die blanken Schemata ws:/wss: erlaubten JEDEN Host — damit koennte
    // ein eingeschleustes Skript Seiteninhalte irgendwohin schicken.
    expect(collabOrigin("wss://collab.example.com/collab")).toEqual([
      "wss://collab.example.com",
    ]);
  });

  it("verschluckt eine unbrauchbare Adresse, statt zu werfen", () => {
    expect(collabOrigin("kein-url")).toEqual([]);
  });
});

describe("createNonce()", () => {
  it("liefert jedes Mal einen anderen Wert", () => {
    const werte = new Set(Array.from({ length: 50 }, createNonce));
    expect(werte.size).toBe(50);
  });

  it("liefert nur Zeichen, die im Header zulaessig sind", () => {
    expect(createNonce()).toMatch(/^[0-9a-f]{32}$/);
  });
});
