import { describe, expect, it } from "vitest";
import { requestCollabTicket } from "./collab-ticket-client";

type Aufruf = { url: string; init: RequestInit | undefined };

/** Ersatz fuer fetch mit fester Antwort, schreibt die Aufrufe mit. */
function fakeFetch(status: number, body: unknown) {
  const aufrufe: Aufruf[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    aufrufe.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, aufrufe };
}

const E = "0123456789abcdef0123456789abcdef";
/** Schema-Hash des Tabs (editorSchema().hash im Editor). */
const H = "0123456789abcdef";

describe("requestCollabTicket()", () => {
  it("schickt pageId, epoch und schema, epoch auch als null", async () => {
    const mit = fakeFetch(200, { ticket: "t1" });
    await requestCollabTicket("p1", E, H, mit.impl);
    expect(mit.aufrufe[0].url).toBe("/api/collab/ticket");
    expect(mit.aufrufe[0].init?.method).toBe("POST");
    expect(JSON.parse(String(mit.aufrufe[0].init?.body))).toEqual({
      pageId: "p1",
      epoch: E,
      schema: H,
    });

    // Die Route erkennt am vorhandenen Schluessel einen Editor, der die
    // Restore-Epoche kennt. Fehlte er bei null, galte der Tab als alter
    // Code und bekaeme ohne Sitzung "Kein Zugriff" statt "neu laden".
    const ohne = fakeFetch(200, { ticket: "t2" });
    await requestCollabTicket("p1", null, H, ohne.impl);
    const body = JSON.parse(String(ohne.aufrufe[0].init?.body)) as object;
    expect(body).toHaveProperty("epoch", null);
  });

  it("gibt bei 200 das Ticket und das Konto zurueck", async () => {
    const f = fakeFetch(200, { ticket: "t1", expiresIn: 120, userId: "u1" });
    await expect(requestCollabTicket("p1", null, H, f.impl)).resolves.toEqual({
      kind: "ticket",
      ticket: "t1",
      userId: "u1",
    });
    // Eine Antwort ohne Konto (aeltere Web-App) prueft der Editor nicht.
    const ohne = fakeFetch(200, { ticket: "t2", expiresIn: 120 });
    await expect(requestCollabTicket("p1", null, H, ohne.impl)).resolves.toEqual({
      kind: "ticket",
      ticket: "t2",
      userId: null,
    });
  });

  // Nur eine endgueltige Ablehnung der Route verwirft die lokale Kopie.
  // Ein Netzfehler, eine Grenze oder ein Serverfehler duerfen das nie:
  // sonst loeschte ein kurzer Ausfall ungesendete Aenderungen.
  it("meldet 401, 403 und 404 mit bekanntem Code als denied", async () => {
    const faelle: Array<[number, string]> = [
      [401, "no-session"],
      [403, "no-access"],
      [404, "not-found"],
    ];
    for (const [status, code] of faelle) {
      const f = fakeFetch(status, { error: "x", code });
      await expect(requestCollabTicket("p1", null, H, f.impl)).resolves.toEqual({
        kind: "denied",
        grund: code,
      });
    }
  });

  it("wirft bei 403 ohne Code (Ungueltige Herkunft) und bei unbekanntem Code", async () => {
    const herkunft = fakeFetch(403, { error: "Ungültige Herkunft" });
    await expect(requestCollabTicket("p1", null, H, herkunft.impl)).rejects.toThrow(
      "Ticket abgelehnt (403)",
    );
    const fremd = fakeFetch(403, { error: "x", code: "etwas-neues" });
    await expect(requestCollabTicket("p1", null, H, fremd.impl)).rejects.toThrow(
      "Ticket abgelehnt (403)",
    );
    // Ein Code gehoert zu seinem Status: no-session mit 403 ist kein
    // "abgemeldet".
    const falsch = fakeFetch(403, { error: "x", code: "no-session" });
    await expect(requestCollabTicket("p1", null, H, falsch.impl)).rejects.toThrow(
      "Ticket abgelehnt (403)",
    );
    for (const status of [400, 429, 500, 502]) {
      const f = fakeFetch(status, { error: "x", code: "no-access" });
      await expect(requestCollabTicket("p1", null, H, f.impl)).rejects.toThrow(
        `Ticket abgelehnt (${status})`,
      );
    }
  });

  it("ein Netzfehler wirft weiter (keine endgueltige Ablehnung)", async () => {
    const netz = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(requestCollabTicket("p1", null, H, netz)).rejects.toThrow("Failed to fetch");
  });

  it("meldet 409 mit restore-epoch als restored", async () => {
    const f = fakeFetch(409, { error: "x", code: "restore-epoch" });
    await expect(requestCollabTicket("p1", null, H, f.impl)).resolves.toEqual({
      kind: "restored",
    });
  });

  it("meldet 409 mit stale-client als stale", async () => {
    const f = fakeFetch(409, { error: "x", code: "stale-client" });
    await expect(requestCollabTicket("p1", null, H, f.impl)).resolves.toEqual({
      kind: "stale",
    });
  });

  it("wirft bei jeder anderen Ablehnung", async () => {
    const ohneCode = fakeFetch(409, { error: "x" });
    // Ein unbekannter Code einer neueren Web-App ist kein "neu laden".
    const fremd = fakeFetch(409, { error: "x", code: "etwas-neues" });
    await expect(requestCollabTicket("p1", null, H, fremd.impl)).rejects.toThrow(
      "Ticket abgelehnt (409)",
    );
    await expect(requestCollabTicket("p1", null, H, ohneCode.impl)).rejects.toThrow(
      "Ticket abgelehnt (409)",
    );
    const verboten = fakeFetch(403, { error: "Kein Zugriff" });
    await expect(requestCollabTicket("p1", null, H, verboten.impl)).rejects.toThrow(
      "Ticket abgelehnt (403)",
    );
    const nichtAngemeldet = fakeFetch(401, { error: "Nicht angemeldet" });
    await expect(
      requestCollabTicket("p1", null, H, nichtAngemeldet.impl),
    ).rejects.toThrow("Ticket abgelehnt (401)");
  });
});
