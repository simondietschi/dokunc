import { describe, expect, it } from "vitest";
import {
  ACCESS_REVOKED_CHANNEL,
  COLLAB_AUDIENCE,
  COLLAB_FIELD,
  DOC_RESET_CHANNEL,
  NOTIFY_CHANNEL_PREFIX,
  PAGE_ACCESS_CHANNEL,
  isAccessRevokedMessage,
  isDocResetMessage,
  isPageAccessMessage,
  type AccessRevokedMessage,
  type DocResetMessage,
  type PageAccessMessage,
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

/**
 * Der Collab-Server liest die Nachrichten mit diesen Pruefern. Was die
 * Web-App sendet (apps/web/src/lib/collab-sync.ts), muss sie passieren;
 * alles andere wird dort mit Log-Eintrag verworfen, statt mit falschen
 * Typen bis in Datenbank und Nonce-Lock zu laufen.
 */
describe("Pruefer fuer die Collab-Nachrichten", () => {
  /** So wie die Nachricht auf der Leitung ankommt: als Text. */
  const wire = (message: unknown): unknown =>
    JSON.parse(JSON.stringify(message));

  /**
   * Werte, die keine Nachricht sein koennen, egal auf welchem Kanal. Je
   * Wert eine eigene Zeile: it.each verteilte eine Liste sonst auf
   * mehrere Argumente, und die Listen selbst kaemen nie an.
   */
  const keinObjekt: [unknown][] = [
    [null],
    [undefined],
    ["p1"],
    [42],
    [true],
    [[]],
    [["p1", "n1"]],
  ];

  describe("isDocResetMessage", () => {
    const gueltig: DocResetMessage = { pageId: "p1", nonce: "n1" };

    it("laesst die gesendete Form durch", () => {
      expect(isDocResetMessage(wire(gueltig))).toBe(true);
    });

    it("laesst zusaetzliche Felder einer neueren Fassung durch", () => {
      expect(isDocResetMessage(wire({ ...gueltig, grund: "restore" }))).toBe(
        true,
      );
    });

    it.each([
      ["ohne nonce", { pageId: "p1" }],
      ["ohne pageId", { nonce: "n1" }],
      ["mit leerer pageId", { pageId: "", nonce: "n1" }],
      ["mit leerer nonce", { pageId: "p1", nonce: "" }],
      ["mit pageId als Zahl", { pageId: 1, nonce: "n1" }],
      ["mit nonce als Objekt", { pageId: "p1", nonce: { v: 1 } }],
      ["mit pageId als null", { pageId: null, nonce: "n1" }],
    ])("verwirft eine Nachricht %s", (_, message) => {
      expect(isDocResetMessage(wire(message))).toBe(false);
    });

    it.each(keinObjekt)("verwirft %j", (value) => {
      expect(isDocResetMessage(value)).toBe(false);
    });
  });

  describe("isAccessRevokedMessage", () => {
    const gueltig: AccessRevokedMessage = { userId: "u1", spaceId: "s1" };

    it("laesst die gesendete Form durch", () => {
      expect(isAccessRevokedMessage(wire(gueltig))).toBe(true);
    });

    it.each([
      ["ohne spaceId", { userId: "u1" }],
      ["ohne userId", { spaceId: "s1" }],
      ["mit leerer userId", { userId: "", spaceId: "s1" }],
      ["mit spaceId als Zahl", { userId: "u1", spaceId: 7 }],
      ["mit userId als Liste", { userId: ["u1"], spaceId: "s1" }],
    ])("verwirft eine Nachricht %s", (_, message) => {
      expect(isAccessRevokedMessage(wire(message))).toBe(false);
    });

    it.each(keinObjekt)("verwirft %j", (value) => {
      expect(isAccessRevokedMessage(value)).toBe(false);
    });
  });

  describe("isPageAccessMessage", () => {
    const gueltig: PageAccessMessage = { pageId: "p1" };

    it("laesst die gesendete Form durch", () => {
      expect(isPageAccessMessage(wire(gueltig))).toBe(true);
    });

    it.each([
      ["ohne pageId", {}],
      ["mit leerer pageId", { pageId: "" }],
      ["mit pageId als Zahl", { pageId: 3 }],
      ["mit pageId als Objekt", { pageId: { id: "p1" } }],
    ])("verwirft eine Nachricht %s", (_, message) => {
      expect(isPageAccessMessage(wire(message))).toBe(false);
    });

    it.each(keinObjekt)("verwirft %j", (value) => {
      expect(isPageAccessMessage(value)).toBe(false);
    });
  });

  it("nimmt eine Nachricht nicht an, der ein Pflichtfeld des Kanals fehlt", () => {
    // Mehr pruefen die Waechter nicht: zusaetzliche Felder sind erlaubt,
    // eine Reset-Nachricht { pageId, nonce } besteht also auch
    // isPageAccessMessage. Auseinander haelt die Kanaele der Server, der
    // nach dem Kanalnamen verzweigt.
    //
    // Eine Seitenzugriffs-Nachricht traegt keine nonce: auf dem
    // Reset-Kanal darf sie kein Neuaufbau ausloesen.
    expect(isDocResetMessage(wire({ pageId: "p1" }))).toBe(false);
    expect(isAccessRevokedMessage(wire({ pageId: "p1", nonce: "n1" }))).toBe(
      false,
    );
  });
});
