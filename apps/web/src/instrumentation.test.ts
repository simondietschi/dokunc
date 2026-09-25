import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

/**
 * `register()` startet den Upload-Aufraeumer nur dort, wo er hingehoert:
 * im Node-Runtime eines laufenden Servers — nicht im Edge-Runtime der
 * Middleware und nicht waehrend `next build`. Und ein Fehler beim Start
 * darf den Server nicht mitreissen.
 */

const sweeper = vi.hoisted(() => ({ startUploadSweeper: vi.fn() }));
vi.mock("@/lib/upload-sweeper", () => sweeper);
// playwright.config.ts laedt die .env des Projekts; hier soll sie nicht
// in die Umgebung der Unit-Tests geraten.
vi.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));

const { register } = await import("./instrumentation");

const vorher = {
  runtime: process.env.NEXT_RUNTIME,
  phase: process.env.NEXT_PHASE,
};

function setEnv(name: "NEXT_RUNTIME" | "NEXT_PHASE", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  sweeper.startUploadSweeper.mockReset();
  setEnv("NEXT_PHASE", undefined);
});

afterEach(() => {
  setEnv("NEXT_RUNTIME", vorher.runtime);
  setEnv("NEXT_PHASE", vorher.phase);
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
