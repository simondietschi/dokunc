import { describe, expect, it } from "vitest";
import { NUR_WEB_VARIABLEN } from "@/lib/config/variablen";
import {
  BREMSEN_AUS_DER_UMGEBUNG,
  RATE_LIMITS,
  RATE_LIMIT_VORGABEN,
  parseRateLimitSpec,
  wirksameBremse,
} from "./rate-limits";

/**
 * Die Bremsen je Adresse sind per Umgebung einstellbar; alle anderen
 * stehen fest. Die Vorgaben muessen einen Standort hinter einer
 * NAT-Adresse tragen: 500 SSO-Anmeldungen in einer Stunde.
 */

describe("Vorgaben der Bremsen", () => {
  it("lassen 500 SSO-Anmeldungen je Stunde aus einer Adresse zu", () => {
    const { versuche, fenster } = RATE_LIMIT_VORGABEN.oidcStart;
    // Ein Fenster von hoechstens einer Stunde mit mindestens 500 Versuchen.
    expect(fenster).toBeLessThanOrEqual(3600);
    expect(versuche).toBeGreaterThanOrEqual(500);
    expect(RATE_LIMIT_VORGABEN.oidcStart).toEqual({ versuche: 600, fenster: 3600 });
  });

  it("aendern die uebrigen Bremsen je Adresse nicht", () => {
    expect(RATE_LIMIT_VORGABEN.loginIp).toEqual({ versuche: 30, fenster: 300 });
    expect(RATE_LIMIT_VORGABEN.register).toEqual({ versuche: 10, fenster: 600 });
    expect(RATE_LIMIT_VORGABEN.resetRequest).toEqual({ versuche: 5, fenster: 900 });
    expect(RATE_LIMIT_VORGABEN.resetSubmit).toEqual({ versuche: 10, fenster: 900 });
    expect(RATE_LIMIT_VORGABEN.login).toEqual({ versuche: 8, fenster: 900 });
    expect(RATE_LIMIT_VORGABEN.upload).toEqual({ versuche: 30, fenster: 60 });
  });
});

describe("wirksameBremse", () => {
  it("nimmt den Wert aus der Umgebung", () => {
    expect(wirksameBremse("loginIp", { RATE_LIMIT_LOGIN_PER_IP: "60/5m" })).toEqual({
      versuche: 60,
      fenster: 300,
    });
    expect(wirksameBremse("oidcStart", { RATE_LIMIT_SSO_START_PER_IP: "1000/2h" })).toEqual({
      versuche: 1000,
      fenster: 7200,
    });
    expect(wirksameBremse("upload", { RATE_LIMIT_UPLOAD_PER_USER: "100/1m" })).toEqual({
      versuche: 100,
      fenster: 60,
    });
  });

  it("nimmt ohne oder mit ungueltigem Wert die Vorgabe", () => {
    // Ungueltige Werte haelt die Pruefung beim Start auf; zur Laufzeit
    // (etwa in Tests) gilt die Vorgabe statt keiner Bremse.
    for (const roh of [undefined, "", "  ", "viele"]) {
      expect(wirksameBremse("loginIp", { RATE_LIMIT_LOGIN_PER_IP: roh }), String(roh)).toEqual(
        RATE_LIMIT_VORGABEN.loginIp,
      );
    }
  });

  it("stellt keine andere Bremse ein", () => {
    expect(
      wirksameBremse("login", { RATE_LIMIT_LOGIN_PER_IP: "1/1s", RATE_LIMIT_LOGIN: "1/1s" }),
    ).toEqual(RATE_LIMIT_VORGABEN.login);
  });

  it("gilt bei jedem Zugriff auf RATE_LIMITS, ohne Zwischenspeicher", () => {
    const vorher = process.env.RATE_LIMIT_REGISTER_PER_IP;
    try {
      process.env.RATE_LIMIT_REGISTER_PER_IP = "3/1m";
      expect(RATE_LIMITS.register).toEqual({ versuche: 3, fenster: 60 });
      process.env.RATE_LIMIT_REGISTER_PER_IP = "";
      expect(RATE_LIMITS.register).toEqual(RATE_LIMIT_VORGABEN.register);
    } finally {
      if (vorher === undefined) delete process.env.RATE_LIMIT_REGISTER_PER_IP;
      else process.env.RATE_LIMIT_REGISTER_PER_IP = vorher;
    }
    expect(RATE_LIMITS.ask).toEqual(RATE_LIMIT_VORGABEN.ask);
    expect(Object.keys(RATE_LIMITS).sort()).toEqual(Object.keys(RATE_LIMIT_VORGABEN).sort());
  });
});

describe("parseRateLimitSpec", () => {
  it.each([
    ["600/1h", { versuche: 600, fenster: 3600 }],
    ["30/300", { versuche: 30, fenster: 300 }],
    ["5/15M", { versuche: 5, fenster: 900 }],
    [" 10 / 30s ", { versuche: 10, fenster: 30 }],
    ["100000/24h", { versuche: 100000, fenster: 86400 }],
  ])("liest %j", (roh, bremse) => {
    expect(parseRateLimitSpec(roh)).toEqual({ ok: true, wert: bremse });
  });

  it("gibt ohne Wert null zurueck (Vorgabe)", () => {
    expect(parseRateLimitSpec(undefined)).toEqual({ ok: true, wert: null });
    expect(parseRateLimitSpec("  ")).toEqual({ ok: true, wert: null });
  });

  it.each(["30", "0/5m", "10/25h", "10/1d", "10/0", "100001/1h", "-1/5m", "1.5/5m", "zehn/5m"])(
    "weist %j ab",
    (roh) => {
      const r = parseRateLimitSpec(roh);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.fehler).toBe(
          `erwartet Versuche/Fenster wie "30/5m" (Versuche 1 bis 100000, Fenster in s, m oder h, hoechstens 24h), erhalten: "${roh}"`,
        );
      }
    },
  );

  it("kuerzt einen langen Wert in der Meldung", () => {
    const r = parseRateLimitSpec("x".repeat(500));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler.length).toBeLessThan(200);
  });
});

describe("Variablen der einstellbaren Bremsen", () => {
  it("heissen nach Muster, sind eindeutig und im Konfigurationsschema der Web-App", () => {
    const namen = Object.values(BREMSEN_AUS_DER_UMGEBUNG);
    expect(new Set(namen).size).toBe(namen.length);
    const deklariert = new Set(NUR_WEB_VARIABLEN.map((v) => v.name));
    for (const name of namen) {
      expect(name).toMatch(/^RATE_LIMIT_[A-Z_]+_PER_(IP|USER)$/);
      expect(deklariert.has(name), name).toBe(true);
    }
  });

  it("nennen je Adresse nur Bremsen je Adresse", () => {
    for (const [schluessel, name] of Object.entries(BREMSEN_AUS_DER_UMGEBUNG)) {
      if (name.endsWith("_PER_IP")) {
        expect(["oidcStart", "loginIp", "register", "resetRequest", "resetSubmit"]).toContain(
          schluessel,
        );
      }
    }
  });
});
