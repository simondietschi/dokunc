import { afterEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("./log", () => ({ log: { warn } }));

import { htmlToPdf } from "./pdf";

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
