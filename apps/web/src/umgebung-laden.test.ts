import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Die drei Stellen, die die Root-.env mit dotenv laden, schreiben dabei
 * nichts auf die Konsole.
 *
 * dotenv 17 meldet jeden Aufruf ohne `quiet` mit einer Zeile wie
 * "◇ injected env (0) from ../../.env // tip: …" auf stdout, auch wenn es
 * keine Datei gibt. Im Container ist das die einzige Zeile des Starts,
 * die kein JSON ist, und Log-Sammler verwerfen oder melden sie.
 */

const STELLEN = [
  ["Web-App (next.config.ts)", () => import("../next.config")],
  ["Collab-Server (src/env.ts)", () => import("../../collab/src/env")],
  ["Prisma-CLI (prisma.config.ts)", () => import("../../../packages/db/prisma.config")],
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("dotenv beim Start", () => {
  it.each(STELLEN)("%s schreibt nichts auf die Konsole", async (_name, laden) => {
    // prisma.config.ts loest DATABASE_URL beim Laden auf.
    vi.stubEnv("DATABASE_URL", "postgresql://pruefung:pruefung@127.0.0.1:5432/pruefung");
    // Eine gesetzte Variable schaltete dotenv auch ohne `quiet` still.
    vi.stubEnv("DOTENV_CONFIG_QUIET", undefined);
    const konsole = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.resetModules();
    await laden();
    expect(konsole).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});
