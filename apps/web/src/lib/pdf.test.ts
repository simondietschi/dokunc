import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("./log", () => ({ log: { warn } }));

import { PDF_TIMEOUT_MS, htmlToPdf } from "./pdf";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  warn.mockReset();
});

describe("htmlToPdf", () => {
  it("gibt ohne GOTENBERG_URL null zurück, ohne anzufragen", async () => {
    vi.stubEnv("GOTENBERG_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await htmlToPdf("<p>x</p>")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loggt einen unerreichbaren Dienst mit dem Fehlerobjekt selbst", async () => {
    // Als Objekt hängt pino Typ, Meldung, Ursache und Stack an. Mit
    // String(e) bliebe nur "TypeError: fetch failed" — und die Ursache
    // (etwa ECONNREFUSED) wäre weg.
    vi.stubEnv("GOTENBERG_URL", "http://gotenberg.invalid:3000");
    const fehler = new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED"),
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(fehler));

    expect(await htmlToPdf("<p>x</p>")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].err).toBe(fehler);
  });
});

/**
 * Ein Gotenberg, der nicht (fertig) antwortet: angehalten, hinter einem
 * haengenden Netz oder ein fremder Dienst ohne eigene Zeitgrenze. Echter
 * fetch gegen einen Server im Test, damit das Signal wirklich an undici
 * haengt.
 */
async function stummerDienst(verhalten: "gar-nicht" | "nach-dem-kopf"): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    req.resume();
    if (verhalten === "nach-dem-kopf") {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.write("%PDF-1.7\n");
    }
    // sonst: nie antworten
  });
  await new Promise<void>((bereit) => server.listen(0, "127.0.0.1", () => bereit()));
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") throw new Error("kein Port");
  return { url: `http://127.0.0.1:${adresse.port}`, server };
}

describe("htmlToPdf mit Zeitgrenze", () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((fertig) => server?.close(fertig) ?? fertig(undefined));
    server = undefined;
  });

  it.each(["gar-nicht", "nach-dem-kopf"] as const)(
    "gibt auf, wenn Gotenberg %s antwortet",
    async (verhalten) => {
      const dienst = await stummerDienst(verhalten);
      server = dienst.server;
      vi.stubEnv("GOTENBERG_URL", dienst.url);
      const start = Date.now();
      expect(await htmlToPdf("<p>x</p>", { timeoutMs: 200 })).toBeNull();
      expect(Date.now() - start).toBeLessThan(2000);
      expect(warn).toHaveBeenCalledTimes(1);
      const [felder, meldung] = warn.mock.calls[0];
      expect(meldung).toBe("gotenberg antwortet nicht innerhalb der Zeitgrenze");
      expect(felder.timeoutMs).toBe(200);
      expect(felder.err.name).toBe("TimeoutError");
    },
    3000,
  );
});

describe("Zeitgrenze passend zu Gotenberg und zur Export-Route", () => {
  // Gotenberg bricht selbst nach --api-timeout mit 503 ab; die eigene
  // Grenze liegt knapp darueber und greift nur, wenn gar keine Antwort
  // kommt. Unter maxDuration der Route, wo eine Plattform sie durchsetzt.
  const wurzel = fileURLToPath(new URL("../../../../", import.meta.url));

  it("liegt ueber --api-timeout in docker-compose.yml", () => {
    const compose = readFileSync(`${wurzel}docker-compose.yml`, "utf8");
    const treffer = [...compose.matchAll(/--api-timeout=(\d+)s/g)].map((t) => Number(t[1]));
    expect(treffer).toHaveLength(1);
    expect(treffer[0] * 1000).toBeLessThan(PDF_TIMEOUT_MS);
    expect(PDF_TIMEOUT_MS - treffer[0] * 1000).toBeLessThanOrEqual(10_000);
  });

  it("liegt unter maxDuration der Export-Route", () => {
    const route = readFileSync(`${wurzel}apps/web/src/app/api/pages/[id]/export/route.ts`, "utf8");
    const treffer = /export const maxDuration = (\d+);/.exec(route);
    expect(treffer).not.toBeNull();
    expect(PDF_TIMEOUT_MS).toBeLessThan(Number(treffer?.[1]) * 1000);
  });
});
