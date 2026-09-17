import { describe, expect, it } from "vitest";
import {
  ACCESS_REVOKED_CHANNEL,
  COLLAB_AUDIENCE,
  COLLAB_FIELD,
  DOC_RESET_CHANNEL,
  NOTIFY_CHANNEL_PREFIX,
  PAGE_ACCESS_CHANNEL,
} from "@dokunc/editor";

/**
 * Diese Werte gehen ueber die Leitung: die Web-App und der getrennt
 * laufende Collab-Prozess muessen dieselben verwenden. Solange beide
 * sie aus packages/editor/src/collab-protocol.ts beziehen, kann keine
 * Seite allein umbenennen — aber bei einem rollierenden Deploy laufen
 * fuer einige Minuten alte und neue Fassung nebeneinander. Wird einer
 * dieser Strings geaendert, bleiben in diesem Fenster Wiederherstellung,
 * Zugriffsentzug und Glocke stumm. Der Test ist kein Beweis, sondern die
 * Stelle, an der das auffaellt: wer ihn anpasst, hat es entschieden.
 */
describe("Collab-Protokoll", () => {
  it("haelt die vereinbarten Werte fest", () => {
    expect(COLLAB_FIELD).toBe("default");
    expect(COLLAB_AUDIENCE).toBe("dokunc-collab");
    expect(NOTIFY_CHANNEL_PREFIX).toBe("dokunc:notify:");
    expect(DOC_RESET_CHANNEL).toBe("dokunc:doc-reset");
    expect(ACCESS_REVOKED_CHANNEL).toBe("dokunc:access-revoked");
    expect(PAGE_ACCESS_CHANNEL).toBe("dokunc:page-access");
  });
});
