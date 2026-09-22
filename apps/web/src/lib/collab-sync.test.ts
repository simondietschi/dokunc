import { afterEach, describe, expect, it, vi } from "vitest";

const { warn, publish } = vi.hoisted(() => ({
  warn: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("./log", () => ({ log: { warn } }));
// Nur die Sendeseite zaehlt hier; eine echte Verbindung braeuchte Redis.
vi.mock("./redis", () => ({
  sharedRedis: () => () => ({ publish }),
}));

import {
  requestDocumentReset,
  revokeCollabAccess,
  revokePageAccess,
} from "./collab-sync";

afterEach(() => {
  warn.mockReset();
  publish.mockReset();
});

describe("collab-sync", () => {
  it("meldet Erfolg, wenn der Doc-Reset abgeschickt wurde", async () => {
    publish.mockResolvedValue(1);
    expect(await requestDocumentReset("p1")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  // Das Fehlerobjekt selbst geht ins Log, nicht String(err): pino haengt
  // daraus Typ und Stack an, und ein geworfenes Objekt ohne toString
  // stuende sonst als "[object Object]" da.
  it("loggt einen gescheiterten Doc-Reset mit dem Fehlerobjekt", async () => {
    const fehler = new Error("Connection is closed.");
    publish.mockRejectedValue(fehler);
    expect(await requestDocumentReset("p1")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({ err: fehler, pageId: "p1" });
    expect(warn.mock.calls[0][0].err).toBe(fehler);
  });

  it("loggt einen gescheiterten Zugriffsentzug mit dem Fehlerobjekt", async () => {
    const fehler = new Error("Connection is closed.");
    publish.mockRejectedValue(fehler);
    await revokeCollabAccess("u1", "s1");
    expect(warn.mock.calls[0][0]).toEqual({
      err: fehler,
      userId: "u1",
      spaceId: "s1",
    });
    expect(warn.mock.calls[0][0].err).toBe(fehler);
  });

  it("loggt einen gescheiterten seitenweisen Entzug mit dem Fehlerobjekt", async () => {
    const fehler = { code: "NOSCRIPT" };
    publish.mockRejectedValue(fehler);
    await revokePageAccess("p2");
    expect(warn.mock.calls[0][0].err).toBe(fehler);
    expect(warn.mock.calls[0][0].pageId).toBe("p2");
  });
});
