import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";
import {
  SETUP_TOKEN_DATEI_VORGABE,
  checkSetupFingerprint,
  checkSetupToken,
  ensureSetupToken,
  istLoopback,
  parseSetupTokenFile,
  retireSetupToken,
  setupFingerprint,
  tokenNoetig,
} from "./setup-token";

const verzeichnis = mkdtempSync(join(tmpdir(), "dokunc-setup-token-"));
let datei: string;
let n = 0;

beforeEach(() => {
  n += 1;
  datei = join(verzeichnis, `token-${n}`);
  vi.stubEnv("SETUP_TOKEN_FILE", datei);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => rmSync(verzeichnis, { recursive: true, force: true }));

describe("tokenNoetig", () => {
  const lokal = ["localhost", "127.0.0.1", "127.8.9.1", "[::1]", "foo.localhost", "LOCALHOST"];
  const fremd = ["wiki.example.com", "192.168.1.10", "0.0.0.0", "[::]", "localhost.example.com", "128.0.0.1"];

  it("kennt Loopback label-genau", () => {
    for (const h of lokal) expect(istLoopback(h), h).toBe(true);
    for (const h of fremd) expect(istLoopback(h), h).toBe(false);
  });

  const kopf = (host: string | null, weitere: Record<string, string> = {}) =>
    new Headers({ ...weitere, ...(host === null ? {} : { host }) });

  it("kein Token nur mit APP_URL und Host auf diesem Rechner", () => {
    for (const h of lokal) {
      expect(tokenNoetig(`https://${h}:7891`, kopf(`${h}:7891`)), h).toBe(false);
    }
    expect(tokenNoetig("http://localhost:3000", kopf("127.0.0.1:3000"))).toBe(false);
  });

  it("Token nötig bei fremder APP_URL, fremdem Host, ohne APP_URL oder Host", () => {
    for (const h of fremd) {
      expect(tokenNoetig(`https://${h}`, kopf("localhost")), h).toBe(true);
    }
    expect(tokenNoetig("https://localhost:7891", kopf("wiki.example.com"))).toBe(true);
    expect(tokenNoetig("https://localhost:7891", kopf(null))).toBe(true);
    expect(tokenNoetig("https://localhost:7891", null)).toBe(true);
    expect(tokenNoetig(undefined, kopf("localhost:3000"))).toBe(true);
    expect(tokenNoetig("", kopf("localhost:3000"))).toBe(true);
    expect(tokenNoetig("kein url", kopf("localhost:3000"))).toBe(true);
  });

  describe("Namen, die ein Proxy weitergibt", () => {
    const lokaleUrl = "http://localhost:3000";
    const noetig = (weitere: Record<string, string>) =>
      tokenNoetig(lokaleUrl, kopf("localhost:3000", weitere));

    it("X-Forwarded-Host: jeder Eintrag zählt", () => {
      expect(noetig({ "x-forwarded-host": "wiki.example.com" })).toBe(true);
      expect(noetig({ "x-forwarded-host": "localhost:3000, wiki.example.com" })).toBe(true);
      expect(noetig({ "x-forwarded-host": "localhost:3000,127.0.0.1" })).toBe(false);
      expect(noetig({ "x-forwarded-host": " , localhost " })).toBe(false);
    });

    it("Forwarded: host= in jedem Element, auch in Anführungszeichen und gross geschrieben", () => {
      expect(noetig({ forwarded: "for=192.0.2.60;proto=https;host=wiki.example.com" })).toBe(true);
      expect(noetig({ forwarded: 'for=192.0.2.60;Host="wiki.example.com"' })).toBe(true);
      expect(noetig({ forwarded: "for=127.0.0.1;host=localhost, for=10.0.0.1;host=wiki.example.com" })).toBe(true);
      expect(noetig({ forwarded: 'for=127.0.0.1;host="localhost:3000"' })).toBe(false);
      expect(noetig({ forwarded: "for=127.0.0.1;proto=http" })).toBe(false);
    });

    it("Origin: fremd, unlesbar oder null verlangt das Token", () => {
      expect(noetig({ origin: "https://wiki.example.com" })).toBe(true);
      expect(noetig({ origin: "null" })).toBe(true);
      expect(noetig({ origin: "kein url" })).toBe(true);
      expect(noetig({ origin: "http://localhost:3000" })).toBe(false);
      expect(noetig({ origin: "http://[::1]:3000" })).toBe(false);
    });

    it("ein unlesbarer weitergegebener Name verlangt das Token", () => {
      expect(noetig({ "x-forwarded-host": "wiki example" })).toBe(true);
      expect(noetig({ forwarded: 'host="a b"' })).toBe(true);
    });
  });
});

describe("Prüfen", () => {
  it("vergleicht mit dem Inhalt der Datei, ohne Leerraum am Rand", async () => {
    writeFileSync(datei, "geheimes-token\n");
    expect(await checkSetupToken("geheimes-token")).toBe(true);
    expect(await checkSetupToken("  geheimes-token ")).toBe(true);
    expect(await checkSetupToken("falsch")).toBe(false);
    expect(await checkSetupToken("")).toBe(false);
    expect(await checkSetupToken(null)).toBe(false);
  });

  it("ohne Datei gilt nichts", async () => {
    expect(await checkSetupToken("irgendwas")).toBe(false);
    expect(await checkSetupFingerprint(setupFingerprint("irgendwas"))).toBe(false);
  });

  it("prüft den Fingerabdruck gegen die Datei", async () => {
    writeFileSync(datei, "geheimes-token\n");
    expect(setupFingerprint("geheimes-token")).toHaveLength(43);
    expect(await checkSetupFingerprint(setupFingerprint("geheimes-token"))).toBe(true);
    expect(await checkSetupFingerprint(setupFingerprint("falsch"))).toBe(false);
    expect(await checkSetupFingerprint("geheimes-token")).toBe(false);
    expect(await checkSetupFingerprint(null)).toBe(false);
  });
});

describe("Anlegen", () => {
  it("legt bei zwei gleichzeitigen Aufrufen genau ein Token an, Modus 600, einmal im Log", async () => {
    const kind = { warn: vi.fn() };
    const child = vi
      .spyOn(log, "child")
      .mockReturnValue(kind as unknown as ReturnType<typeof log.child>);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    const [a, b] = await Promise.all([
      ensureSetupToken({ offen: true }),
      ensureSetupToken({ offen: true }),
    ]);
    expect(a).toEqual({ offen: true, tokenBereit: true, datei });
    expect(b).toEqual({ offen: true, tokenBereit: true, datei });
    const token = readFileSync(datei, "utf8").trim();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(statSync(datei).mode & 0o777).toBe(0o600);

    // Die Zeile mit dem Token genau einmal, über einen Kindlogger mit
    // eigener Stufe: sie erscheint auch mit LOG_LEVEL=error.
    expect(child).toHaveBeenCalledWith({}, { level: "info" });
    expect(kind.warn).toHaveBeenCalledTimes(1);
    expect(kind.warn.mock.calls[0][0]).toEqual({ file: datei, setupToken: token });
    // Der andere Aufruf nennt nur die Datei.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
  });

  it("scheitert das Schreiben, bleibt das Token aus und der Fehler steht einmal im Log", async () => {
    vi.stubEnv("SETUP_TOKEN_FILE", join(verzeichnis, "fehlt", "setup_token"));
    const fehler = vi.spyOn(log, "error").mockImplementation(() => undefined);
    expect(await ensureSetupToken({ offen: true })).toMatchObject({ tokenBereit: false });
    expect(await ensureSetupToken({ offen: true })).toMatchObject({ tokenBereit: false });
    expect(fehler).toHaveBeenCalledTimes(1);
  });

  it("räumt nach dem ersten Konto eine liegengebliebene Datei weg", async () => {
    writeFileSync(datei, "alt\n");
    vi.spyOn(log, "info").mockImplementation(() => undefined);
    expect(await ensureSetupToken({ offen: false })).toMatchObject({ offen: false });
    expect(existsSync(datei)).toBe(false);
    await retireSetupToken();
  });
});

describe("SETUP_TOKEN_FILE", () => {
  it("nimmt einen absoluten Pfad, leer ist die Vorgabe", () => {
    expect(parseSetupTokenFile(undefined)).toEqual({ ok: true, wert: SETUP_TOKEN_DATEI_VORGABE });
    expect(parseSetupTokenFile(" /var/lib/dokunc/token ")).toEqual({
      ok: true,
      wert: "/var/lib/dokunc/token",
    });
    const r = parseSetupTokenFile("data/setup_token");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler).toMatch(/^SETUP_TOKEN_FILE/);
  });
});
