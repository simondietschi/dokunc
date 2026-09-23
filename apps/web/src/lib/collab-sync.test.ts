import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOC_RESET_ACK_PREFIX,
  DOC_RESET_ACK_TIMEOUT_MS,
  DOC_RESET_CHANNEL,
} from "@dokunc/editor";

const { warn, publish, blpop, disconnect, redisDa } = vi.hoisted(() => ({
  warn: vi.fn(),
  publish: vi.fn(),
  blpop: vi.fn(),
  disconnect: vi.fn(),
  redisDa: { value: true },
}));
vi.mock("./log", () => ({ log: { warn } }));
// Nur die Redis-Befehle zaehlen hier; eine echte Verbindung braeuchte
// Redis. `redisDa` spielt eine Umgebung ohne REDIS_URL nach: dann
// liefern beide Fabriken null.
vi.mock("./redis", () => ({
  sharedRedis: () => () => (redisDa.value ? { publish } : null),
  createRedis: () => (redisDa.value ? { blpop, disconnect } : null),
}));

import {
  readStaleRestore,
  requestDocumentReset,
  revokeCollabAccess,
  revokePageAccess,
} from "./collab-sync";

afterEach(() => {
  warn.mockReset();
  publish.mockReset();
  blpop.mockReset();
  disconnect.mockReset();
  redisDa.value = true;
  vi.useRealTimers();
});

/** So legt der Collab-Server die Quittung ab (siehe apps/collab). */
function quittung(ok: boolean, outcome: string): [string, string] {
  return ["schluessel", JSON.stringify({ ok, outcome })];
}

describe("requestDocumentReset", () => {
  it("meldet Erfolg erst mit positiver Quittung des Collab-Servers", async () => {
    publish.mockResolvedValue(1);
    blpop.mockResolvedValue(quittung(true, "zurueckgesetzt"));
    expect(await requestDocumentReset("p1", "v1", "u1")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("schickt Seite, Version, Person und Nonce und wartet auf genau diese Nonce", async () => {
    publish.mockResolvedValue(1);
    blpop.mockResolvedValue(quittung(true, "zurueckgesetzt"));
    await requestDocumentReset("p1", "v1", "u1");
    expect(publish).toHaveBeenCalledTimes(1);
    const [kanal, text] = publish.mock.calls[0];
    expect(kanal).toBe(DOC_RESET_CHANNEL);
    const nachricht = JSON.parse(text);
    // Die Person traegt der Collab-Server beim Speichern als Bearbeiter
    // ein; ohne sie stuende dort "System".
    expect(nachricht).toMatchObject({
      pageId: "p1",
      versionId: "v1",
      actorId: "u1",
    });
    expect(typeof nachricht.nonce).toBe("string");
    expect(blpop).toHaveBeenCalledWith(
      `${DOC_RESET_ACK_PREFIX}${nachricht.nonce}`,
      DOC_RESET_ACK_TIMEOUT_MS / 1000,
    );
    // Die Warteverbindung wird nach dem Warten wieder geschlossen.
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("meldet keinen Erfolg bei negativer Quittung und nennt das Ergebnis im Log", async () => {
    publish.mockResolvedValue(1);
    blpop.mockResolvedValue(quittung(false, "fehlgeschlagen"));
    expect(await requestDocumentReset("p1", "v1", "u1")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      { pageId: "p1", outcome: "fehlgeschlagen" },
      "Doc-Reset vom Collab-Server nicht ausgefuehrt",
    );
  });

  it("meldet keinen Erfolg, wenn keine Quittung kommt (Zeitlimit von BLPOP)", async () => {
    publish.mockResolvedValue(1);
    blpop.mockResolvedValue(null);
    expect(await requestDocumentReset("p1", "v1", "u1")).toBe(false);
    expect(warn.mock.calls[0][1]).toBe(
      "Doc-Reset ohne Quittung des Collab-Servers",
    );
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  // Haengt schon der Verbindungsaufbau, kommt BLPOP nie zurueck. Die
  // Person soll trotzdem nach wenigen Sekunden ihre Antwort haben.
  it("gibt nach dem eigenen Zeitgeber auf, wenn BLPOP haengt", async () => {
    vi.useFakeTimers();
    publish.mockResolvedValue(1);
    blpop.mockReturnValue(new Promise(() => {}));
    const ergebnis = requestDocumentReset("p1", "v1", "u1");
    await vi.advanceTimersByTimeAsync(DOC_RESET_ACK_TIMEOUT_MS + 500);
    expect(await ergebnis).toBe(false);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("wartet nicht, wenn kein Collab-Server auf dem Kanal hoert", async () => {
    publish.mockResolvedValue(0);
    expect(await requestDocumentReset("p1", "v1", "u1")).toBe(false);
    expect(blpop).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { pageId: "p1" },
      "Doc-Reset: kein Collab-Server hoert zu",
    );
  });

  it("liefert ohne REDIS_URL false und sendet nichts", async () => {
    redisDa.value = false;
    expect(await requestDocumentReset("p1", "v1", "u1")).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(blpop).not.toHaveBeenCalled();
  });

  // Das Fehlerobjekt selbst geht ins Log, nicht String(err): pino haengt
  // daraus Typ und Stack an, und ein geworfenes Objekt ohne toString
  // stuende sonst als "[object Object]" da.
  it("loggt einen gescheiterten Doc-Reset mit dem Fehlerobjekt", async () => {
    const fehler = new Error("Connection is closed.");
    publish.mockRejectedValue(fehler);
    expect(await requestDocumentReset("p1", "v1", "u1")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({ err: fehler, pageId: "p1" });
    expect(warn.mock.calls[0][0].err).toBe(fehler);
    expect(blpop).not.toHaveBeenCalled();
  });

  it("wertet einen Fehler beim Warten wie eine fehlende Quittung", async () => {
    const fehler = new Error("Connection is closed.");
    publish.mockResolvedValue(1);
    blpop.mockRejectedValue(fehler);
    expect(await requestDocumentReset("p1", "v1", "u1")).toBe(false);
    expect(warn.mock.calls[0][0].err).toBe(fehler);
  });

  it.each([
    ["kein JSON", "ok"],
    ["ohne ok", JSON.stringify({ outcome: "zurueckgesetzt" })],
    ["ok als Text", JSON.stringify({ ok: "true", outcome: "zurueckgesetzt" })],
  ])("nimmt eine Quittung %s nicht als Erfolg", async (_, roh) => {
    publish.mockResolvedValue(1);
    blpop.mockResolvedValue(["schluessel", roh]);
    expect(await requestDocumentReset("p1", "v1", "u1")).toBe(false);
    expect(warn.mock.calls[0][1]).toBe(
      "Quittung des Doc-Resets hat eine unerwartete Form",
    );
  });
});

describe("collab-sync", () => {
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

describe("readStaleRestore", () => {
  it("zeigt ohne Merker keinen Hinweis", () => {
    expect(readStaleRestore(undefined)).toEqual({ offen: false, versionId: null });
    expect(readStaleRestore("")).toEqual({ offen: false, versionId: null });
    expect(readStaleRestore(["a", "b"])).toEqual({
      offen: false,
      versionId: null,
    });
  });

  // Der Link im Hinweis fuehrt direkt zur Version, die noch einmal
  // wiederhergestellt werden soll.
  it("liest die Version aus dem Merker", () => {
    expect(readStaleRestore("cmueb43vl0007607d1ngjkim7")).toEqual({
      offen: true,
      versionId: "cmueb43vl0007607d1ngjkim7",
    });
  });

  // Der Wert steht in der Adresse und geht in einen Link: nur eine
  // schlichte Kennung, sonst der Hinweis mit Link zum Verlauf.
  it.each(["1", "../../etc", "abc/def?x=1", "x".repeat(65)])(
    "zeigt bei %j den Hinweis ohne Version",
    (wert) => {
      expect(readStaleRestore(wert)).toEqual({ offen: true, versionId: null });
    },
  );
});
