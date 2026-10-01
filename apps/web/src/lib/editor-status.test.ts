import { describe, expect, it, vi } from "vitest";
import { COLLAB_REJECT_REASON } from "@dokunc/editor";
import {
  editorEditable,
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

  it("eine veraltete Restore-Epoche heisst: neu laden", () => {
    expect(statusAfterRejection(COLLAB_REJECT_REASON.restoreEpoch)).toBe(
      "restored",
    );
  });

  // Web-App und Collab-Server fahren gerade verschiedene Fassungen des
  // Editors (mitten in einem Update): das geht vorbei, neu anmelden hilft
  // nicht.
  it("ein abweichendes Editor-Schema heisst: Aktualisierung laeuft", () => {
    expect(statusAfterRejection(COLLAB_REJECT_REASON.schemaMismatch)).toBe(
      "updating",
    );
  });
});

describe("statusAfterDisconnect()", () => {
  it("eine Ablehnung ueberdauert das anschliessende Trennen", () => {
    expect(statusAfterDisconnect("unauthorized")).toBe("unauthorized");
    expect(statusAfterDisconnect("limited")).toBe("limited");
    expect(statusAfterDisconnect("updating")).toBe("updating");
  });

  it("endgueltige Status bleiben stehen", () => {
    for (const s of ["restored", "stale", "too-large"] as const) {
      expect(statusAfterDisconnect(s)).toBe(s);
    }
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
function statusZustand(
  start: EditorStatus = "connecting",
  opts?: { onMessageTooLarge?: () => void },
) {
  let wert = start;
  const setStatus: SetEditorStatus = (next) => {
    wert = typeof next === "function" ? next(wert) : next;
  };
  return {
    h: statusHandlers(setStatus, opts),
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

  // Nach dem abgewiesenen Ticket (409 restore-epoch) setzt der Editor
  // "restored" selbst; der Provider meldet danach noch eine Ablehnung
  // mit eigenem Grund, ein Trennen und womoeglich einen Abgleich. Nichts
  // davon darf den Tab wieder als "Kein Zugriff" oder "Live" zeigen.
  it("restored bleibt stehen, was der Provider danach auch meldet", () => {
    const z = statusZustand("restored");
    z.h.onAuthenticationFailed({
      reason: "Failed to get token: Error: Instanz wurde zurückgespielt",
    });
    expect(z.wert).toBe("restored");
    z.h.onDisconnect();
    z.h.onStatus({ status: "disconnected" });
    z.h.onStatus({ status: "connecting" });
    expect(z.wert).toBe("restored");
    z.h.onSynced();
    expect(z.wert).toBe("restored");
  });

  // Nach dem abgewiesenen Ticket (409 stale-client) setzt der Editor
  // "stale" selbst und trennt endgueltig. Was der Provider danach noch
  // meldet, darf den Tab nicht wieder als "Live" oder "Kein Zugriff"
  // zeigen: er muss neu geladen werden.
  it("stale bleibt stehen, was der Provider danach auch meldet", () => {
    const z = statusZustand("stale");
    z.h.onAuthenticationFailed({
      reason: "Failed to get token: Error: Neue Version verfügbar",
    });
    z.h.onAuthenticationFailed({ reason: COLLAB_REJECT_REASON.schemaMismatch });
    expect(z.wert).toBe("stale");
    z.h.onDisconnect();
    z.h.onStatus({ status: "disconnected" });
    z.h.onStatus({ status: "connecting" });
    z.h.onClose({ event: { code: 1009 } });
    expect(z.wert).toBe("stale");
    z.h.onSynced();
    expect(z.wert).toBe("stale");
  });

  it("Aktualisierung laeuft bleibt bis zum naechsten Abgleich stehen", () => {
    const z = statusZustand("connected");
    z.h.onAuthenticationFailed({ reason: COLLAB_REJECT_REASON.schemaMismatch });
    expect(z.wert).toBe("updating");
    z.h.onStatus({ status: "disconnected" });
    z.h.onDisconnect();
    z.h.onStatus({ status: "connecting" });
    z.h.onStatus({ status: "connected" });
    expect(z.wert).toBe("updating");
    // Der Provider versucht es von selbst erneut; gelingt es, ist er Live.
    z.h.onSynced();
    expect(z.wert).toBe("connected");
  });

  it("die Ablehnung restore-epoch des Collab-Servers fuehrt zu restored", () => {
    const z = statusZustand("connected");
    z.h.onAuthenticationFailed({ reason: COLLAB_REJECT_REASON.restoreEpoch });
    expect(z.wert).toBe("restored");
    z.h.onDisconnect();
    expect(z.wert).toBe("restored");
  });
});

/**
 * Close-Code 1009: der Collab-Server hat eine Nachricht als zu gross
 * abgewiesen. Der Editor trennt dann endgueltig (onMessageTooLarge),
 * sonst verbaende der Provider jede Sekunde neu und schickte dieselbe
 * Aenderung wieder.
 */
describe("statusHandlers() bei einer zu grossen Nachricht", () => {
  it("1009 fuehrt zu too-large und trennt genau einmal", () => {
    const trennen = vi.fn();
    const z = statusZustand("connected", { onMessageTooLarge: trennen });
    z.h.onClose({ event: { code: 1009 } });
    expect(z.wert).toBe("too-large");
    expect(trennen).toHaveBeenCalledTimes(1);
    // Was der Provider danach meldet, verlaesst too-large nicht.
    z.h.onStatus({ status: "connecting" });
    z.h.onDisconnect();
    z.h.onSynced();
    z.h.onAuthenticationFailed({ reason: "x" });
    expect(z.wert).toBe("too-large");
    expect(trennen).toHaveBeenCalledTimes(1);
  });

  it("andere Close-Codes aendern nichts", () => {
    for (const code of [1000, 1006]) {
      const trennen = vi.fn();
      const z = statusZustand("connected", { onMessageTooLarge: trennen });
      z.h.onClose({ event: { code } });
      expect(z.wert).toBe("connected");
      expect(trennen).not.toHaveBeenCalled();
    }
    // Ohne Ereignis ebenfalls nichts.
    const z = statusZustand("connected");
    z.h.onClose({});
    expect(z.wert).toBe("connected");
  });

  it("restored und stale haben Vorrang vor too-large", () => {
    for (const vorher of ["restored", "stale"] as const) {
      const trennen = vi.fn();
      const z = statusZustand(vorher, { onMessageTooLarge: trennen });
      z.h.onClose({ event: { code: 1009 } });
      expect(z.wert).toBe(vorher);
    }
  });

  it("ohne Rueckruf setzt 1009 trotzdem too-large", () => {
    const z = statusZustand("connected");
    z.h.onClose({ event: { code: 1009 } });
    expect(z.wert).toBe("too-large");
  });
});

describe("too-large ausserhalb der Rueckrufe", () => {
  it("bleibt nach dem Trennen und offline stehen, mit eigener Beschriftung", () => {
    expect(statusAfterDisconnect("too-large")).toBe("too-large");
    expect(visibleStatus("too-large", false)).toBe("too-large");
    expect(statusLabel("too-large").text).toBe("Änderung zu gross");
    expect(statusLabel("too-large").title).toMatch(/nicht übertragen/);
  });
});

describe("editorEditable()", () => {
  it("die Groessensperre sperrt den Editor", () => {
    expect(
      editorEditable({ editable: true, connected: true, sizeLevel: "frozen" }),
    ).toBe(false);
  });

  it("warn und kein Hinweis sperren nicht", () => {
    for (const sizeLevel of ["warn", "ok", null] as const) {
      expect(editorEditable({ editable: true, connected: true, sizeLevel })).toBe(
        true,
      );
    }
  });

  it("ohne Verbindung oder ohne Schreibrecht wie bisher gesperrt", () => {
    expect(
      editorEditable({ editable: true, connected: false, sizeLevel: null }),
    ).toBe(false);
    expect(
      editorEditable({ editable: false, connected: true, sizeLevel: "ok" }),
    ).toBe(false);
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
    expect(visibleStatus("restored", false)).toBe("restored");
    expect(visibleStatus("stale", false)).toBe("stale");
    expect(visibleStatus("updating", false)).toBe("updating");
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

  it("bittet bei einer neuen Version um Neuladen, nicht um Anmelden", () => {
    const { text, title } = statusLabel("stale");
    expect(text).toBe("Neue Version");
    expect(title).toMatch(/neu laden/);
    expect(title).not.toMatch(/anmelden/);
  });

  it("sagt waehrend eines Updates, dass es von selbst weitergeht", () => {
    const { text, title } = statusLabel("updating");
    expect(text).toBe("Aktualisierung läuft");
    expect(title).toMatch(/von selbst/);
    expect(title).not.toMatch(/anmelden/);
  });

  // Bearbeiten ohne Verbindung ist gesperrt (editorEditable verlangt
  // "connected"); der alte Text versprach, Aenderungen wuerden offline
  // gesichert und spaeter uebertragen.
  it("offline: verspricht kein Bearbeiten ohne Verbindung", () => {
    const { text, title } = statusLabel("offline");
    expect(text).toBe("Offline");
    expect(title).toMatch(/Bearbeiten ist erst wieder möglich, wenn die Verbindung steht/);
    expect(title).toMatch(/bis zur Abmeldung auf diesem Gerät/);
    expect(title).not.toMatch(/später übertragen/);
  });

  it("offline ohne lokale Kopie: sagt, dass Ungesendetes nur im Tab liegt", () => {
    const { text, title } = statusLabel("offline", { ohneKopie: true });
    expect(text).toBe("Offline");
    expect(title).toMatch(/keine lokale Kopie/);
    expect(title).not.toMatch(/bis zur Abmeldung auf diesem Gerät/);
    // Verbunden sagt es der Tooltip ebenso; ohne die Angabe bleibt "Live" ohne.
    expect(statusLabel("connected", { ohneKopie: true }).title).toMatch(/keine lokale Kopie/);
    expect(statusLabel("connected")).toEqual({ text: "Live" });
  });

  // Nach einer endgueltigen Ablehnung der Ticket-Route und bei einem
  // anderen Konto im Browser ist die Kopie der Seite geloescht. Die Bitte
  // "neu laden" allein verschwieg, dass genau das Neuladen verwirft, was
  // der Server noch nicht bestaetigt hat.
  it("Kein Zugriff ohne lokale Kopie: sagt, dass Neuladen Ungesendetes verwirft", () => {
    const { text, title } = statusLabel("unauthorized", { ohneKopie: true });
    expect(text).toBe("Kein Zugriff");
    expect(title).toMatch(/keine lokale Kopie/);
    expect(title).toMatch(/geht beim Schließen oder Neuladen verloren/);
    expect(title).toMatch(/anderes Konto/);
    // Mit Kopie bleibt der bisherige Text.
    expect(statusLabel("unauthorized").title).not.toMatch(/keine lokale Kopie/);
    expect(statusLabel("unauthorized").title).toMatch(/neu anmelden/);
  });

  it("bittet nach einem Restore um Neuladen", () => {
    const { text, title } = statusLabel("restored");
    expect(text).toBe("Neu laden nötig");
    expect(title).toMatch(/zurückgespielt/);
  });
});
