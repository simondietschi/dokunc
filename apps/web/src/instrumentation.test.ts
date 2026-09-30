import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

/**
 * `register()` startet den Upload-Aufraeumer nur dort, wo er hingehoert:
 * im Node-Runtime eines laufenden Servers — nicht im Edge-Runtime der
 * Middleware und nicht waehrend `next build`. Und ein Fehler beim Start
 * darf den Server nicht mitreissen.
 *
 * Vor allen Hintergrundjobs prueft `register()` die Konfiguration; bei
 * einem Fehler endet der Prozess mit Code 78, und kein Job startet.
 */

const sweeper = vi.hoisted(() => ({ startUploadSweeper: vi.fn() }));
vi.mock("@/lib/upload-sweeper", () => sweeper);
const retention = vi.hoisted(() => ({ startRetentionJob: vi.fn() }));
vi.mock("@/lib/retention", () => retention);
const einrichtung = vi.hoisted(() => ({ ensureSetupToken: vi.fn(async () => undefined) }));
vi.mock("@/lib/setup-token", async (importOriginal) => ({
  // Der Parser von SETUP_TOKEN_FILE gehört zur Konfigurationsprüfung.
  ...(await importOriginal<typeof import("@/lib/setup-token")>()),
  ...einrichtung,
}));
const logger = vi.hoisted(() => ({
  log: { level: "info", fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/log", () => logger);
// playwright.config.ts laedt die .env des Projekts; hier soll sie nicht
// in die Umgebung der Unit-Tests geraten.
vi.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));

const { register } = await import("./instrumentation");

const vorher = {
  runtime: process.env.NEXT_RUNTIME,
  phase: process.env.NEXT_PHASE,
  logLevel: process.env.LOG_LEVEL,
};

function setEnv(name: "NEXT_RUNTIME" | "NEXT_PHASE" | "LOG_LEVEL", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  sweeper.startUploadSweeper.mockReset();
  retention.startRetentionJob.mockReset();
  einrichtung.ensureSetupToken.mockReset();
  einrichtung.ensureSetupToken.mockImplementation(async () => undefined);
  for (const f of [logger.log.fatal, logger.log.warn, logger.log.info]) f.mockReset();
  setEnv("NEXT_PHASE", undefined);
  setEnv("LOG_LEVEL", undefined);
});

afterEach(() => {
  setEnv("NEXT_RUNTIME", vorher.runtime);
  setEnv("NEXT_PHASE", vorher.phase);
  setEnv("LOG_LEVEL", vorher.logLevel);
  vi.restoreAllMocks();
});

describe("register", () => {
  it("startet den Aufraeumer im Node-Runtime", async () => {
    setEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(sweeper.startUploadSweeper).toHaveBeenCalledTimes(1);
  });

  it("laesst ihn im Edge-Runtime aus", async () => {
    setEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(sweeper.startUploadSweeper).not.toHaveBeenCalled();
  });

  it("laesst ihn waehrend next build aus", async () => {
    setEnv("NEXT_RUNTIME", "nodejs");
    setEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(sweeper.startUploadSweeper).not.toHaveBeenCalled();
  });

  it("haelt einen Fehler beim Start vom Server fern", async () => {
    setEnv("NEXT_RUNTIME", "nodejs");
    sweeper.startUploadSweeper.mockImplementation(() => {
      throw new Error("kaputt");
    });
    const konsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(register()).resolves.toBeUndefined();
      expect(konsole).toHaveBeenCalled();
    } finally {
      konsole.mockRestore();
    }
  });
});

describe("register prueft die Konfiguration", () => {
  it("bricht bei einem ungueltigen Wert mit Code 78 ab, bevor ein Job startet", async () => {
    setEnv("NEXT_RUNTIME", "nodejs");
    setEnv("LOG_LEVEL", "gespraechig");
    // Das echte process.exit beendete den Testlauf; ersetzt kehrt es
    // zurueck, und register() darf trotzdem nicht weiterlaufen.
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await expect(register()).rejects.toThrow();
    expect(exit).toHaveBeenCalledWith(78);
    expect(logger.log.fatal).toHaveBeenCalledTimes(1);
    expect(sweeper.startUploadSweeper).not.toHaveBeenCalled();
    expect(retention.startRetentionJob).not.toHaveBeenCalled();
  });

  it("startet beide Jobs wie bisher, wenn die Konfiguration gilt", async () => {
    setEnv("NEXT_RUNTIME", "nodejs");
    setEnv("LOG_LEVEL", "DEBUG");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(logger.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ LOG_LEVEL: "debug" }) }),
      "Konfiguration geprueft",
    );
    expect(sweeper.startUploadSweeper).toHaveBeenCalledTimes(1);
    expect(retention.startRetentionJob).toHaveBeenCalledTimes(1);
  });
});

describe("register legt das Einrichtungs-Token an", () => {
  it("nach der Konfiguration, ohne auf die Datenbank zu warten", async () => {
    setEnv("NEXT_RUNTIME", "nodejs");
    let fertig: () => void = () => undefined;
    einrichtung.ensureSetupToken.mockImplementation(
      () => new Promise<undefined>((r) => (fertig = () => r(undefined))),
    );
    // register() kehrt zurück, obwohl die Prüfung der Datenbank noch
    // läuft, und startet die Jobs trotzdem.
    await register();
    expect(einrichtung.ensureSetupToken).toHaveBeenCalledTimes(1);
    expect(sweeper.startUploadSweeper).toHaveBeenCalledTimes(1);
    fertig();
  });

  it("ein Fehler dabei hält den Server nicht auf", async () => {
    setEnv("NEXT_RUNTIME", "nodejs");
    einrichtung.ensureSetupToken.mockImplementation(async () => {
      throw new Error("Datenbank weg");
    });
    const konsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(register()).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(konsole).toHaveBeenCalledWith(
      "Einrichtungs-Token beim Start nicht geprueft:",
      expect.any(Error),
    );
    expect(retention.startRetentionJob).toHaveBeenCalledTimes(1);
  });

  it("nicht, wenn die Konfiguration ungültig ist", async () => {
    setEnv("NEXT_RUNTIME", "nodejs");
    setEnv("LOG_LEVEL", "gespraechig");
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await expect(register()).rejects.toThrow();
    expect(einrichtung.ensureSetupToken).not.toHaveBeenCalled();
  });
});

describe("E2E-Server", () => {
  it("startet die Web-App mit abgeschaltetem Aufraeumer", async () => {
    // globalSetup leert die Datenbank der Entwicklungsumgebung, deren
    // Upload-Verzeichnis next start benutzt. Mit laufendem Aufraeumer
    // saehe dort jede alte Datei verwaist aus.
    const pfad = fileURLToPath(new URL("../../../playwright.config.ts", import.meta.url));
    const { default: config } = (await import(/* @vite-ignore */ pfad)) as {
      default: { webServer: { command: string; env?: Record<string, string> }[] };
    };
    const web = config.webServer.find((s) => s.command.includes("@dokunc/web start"));
    // Nur dieser eine Wert: Playwright legt `env` ueber process.env, alles
    // andere kommt weiter aus der Umgebung.
    expect(web?.env).toEqual({ UPLOAD_SWEEP_INTERVAL_H: "0" });
  });
});
