import { describe, expect, it } from "vitest";
import { COLLAB_REJECT_REASON } from "@dokunc/editor";
import {
  statusAfterDisconnect,
  statusAfterRejection,
  statusHandlers,
  statusLabel,
  visibleStatus,
  type EditorStatus,
  type SetEditorStatus,
} from "./editor-status";

describe("statusAfterRejection()", () => {
  it("eine Grenze des Collab-Servers ist kein entzogener Zugriff", () => {
    // Unter "Kein Zugriff" stand die Bitte, sich neu anzumelden. Bei zu
    // vielen offenen Tabs hilft das nicht, Tabs schliessen schon.
    expect(statusAfterRejection(COLLAB_REJECT_REASON.tooManyConnections)).toBe(
      "limited",
    );
    expect(statusAfterRejection(COLLAB_REJECT_REASON.rateLimited)).toBe(
      "limited",
    );
  });

  it("alles andere bleibt eine Ablehnung des Zugriffs", () => {
    expect(statusAfterRejection("permission-denied")).toBe("unauthorized");
    // Ein normaler Client schickt nie ein verbrauchtes Ticket.
    expect(statusAfterRejection(COLLAB_REJECT_REASON.ticketUsed)).toBe(
      "unauthorized",
    );
    expect(statusAfterRejection("")).toBe("unauthorized");
  });
});

describe("statusAfterDisconnect()", () => {
  it("eine Ablehnung ueberdauert das anschliessende Trennen", () => {
    expect(statusAfterDisconnect("unauthorized")).toBe("unauthorized");
    expect(statusAfterDisconnect("limited")).toBe("limited");
  });

  it("sonst heisst Trennen: neu verbinden", () => {
    const vorher: EditorStatus[] = ["connected", "connecting", "offline"];
    for (const s of vorher) expect(statusAfterDisconnect(s)).toBe("connecting");
  });
});

/**
 * Ersatz fuer useState: fuehrt Werte und Fortschreibungen aus wie React,
 * damit die Rueckrufe gegen einen echten Zustand laufen und nicht gegen
 * eine Aufzeichnung ihrer Aufrufe.
 */
function statusZustand(start: EditorStatus = "connecting") {
  let wert = start;
  const setStatus: SetEditorStatus = (next) => {
    wert = typeof next === "function" ? next(wert) : next;
  };
  return {
    h: statusHandlers(setStatus),
    get wert() {
      return wert;
    },
  };
}

describe("statusHandlers()", () => {
  it("eine Grenze bleibt ueber Trennen und Statuswechsel stehen", () => {
    const z = statusZustand();
    z.h.onAuthenticationFailed({
      reason: COLLAB_REJECT_REASON.tooManyConnections,
    });
    expect(z.wert).toBe("limited");
    // So meldet der Provider das anschliessende Trennen und den
    // naechsten Versuch.
    z.h.onStatus({ status: "disconnected" });
    z.h.onDisconnect();
    z.h.onStatus({ status: "connecting" });
    z.h.onStatus({ status: "connected" });
    expect(z.wert).toBe("limited");
    // Erst der gelungene Abgleich loest sie ab.
    z.h.onSynced();
    expect(z.wert).toBe("connected");
  });

  it("zu viele Versuche sind ebenfalls eine Grenze", () => {
    const z = statusZustand();
    z.h.onAuthenticationFailed({ reason: COLLAB_REJECT_REASON.rateLimited });
    z.h.onDisconnect();
    expect(z.wert).toBe("limited");
  });

  it("eine Ablehnung des Zugriffs heisst Kein Zugriff, auch nach dem Trennen", () => {
    const z = statusZustand("connected");
    z.h.onAuthenticationFailed({ reason: "permission-denied" });
    expect(z.wert).toBe("unauthorized");
    z.h.onStatus({ status: "disconnected" });
    z.h.onDisconnect();
    expect(z.wert).toBe("unauthorized");
    z.h.onSynced();
    expect(z.wert).toBe("connected");
  });

  it("ein offener Socket ist noch nicht Live, Trennen heisst neu verbinden", () => {
    const z = statusZustand();
    z.h.onStatus({ status: "connected" });
    expect(z.wert).toBe("connecting");
    z.h.onSynced();
    expect(z.wert).toBe("connected");
    z.h.onStatus({ status: "disconnected" });
    expect(z.wert).toBe("connecting");
    z.h.onSynced();
    z.h.onDisconnect();
    expect(z.wert).toBe("connecting");
  });
});

describe("visibleStatus()", () => {
  it("ohne Netz steht Offline statt Verbinde…", () => {
    expect(visibleStatus("connecting", false)).toBe("offline");
    expect(visibleStatus("connecting", true)).toBe("connecting");
  });

  it("verbunden und abgelehnt bleiben auch offline stehen", () => {
    expect(visibleStatus("connected", false)).toBe("connected");
    expect(visibleStatus("unauthorized", false)).toBe("unauthorized");
    expect(visibleStatus("limited", false)).toBe("limited");
  });
});

describe("statusLabel()", () => {
  it("sagt bei einer Grenze, was hilft, und nicht 'neu anmelden'", () => {
    const { text, title } = statusLabel("limited");
    expect(text).toBe("Zu viele Verbindungen");
    expect(title).toMatch(/andere Tabs/);
    expect(title).not.toMatch(/anmelden/);
  });

  it("behaelt die bisherigen Beschriftungen", () => {
    expect(statusLabel("connected")).toEqual({ text: "Live" });
    expect(statusLabel("connecting")).toEqual({ text: "Verbinde…" });
    expect(statusLabel("offline").text).toBe("Offline");
    expect(statusLabel("unauthorized").text).toBe("Kein Zugriff");
    expect(statusLabel("unauthorized").title).toMatch(/neu anmelden/);
  });
});
