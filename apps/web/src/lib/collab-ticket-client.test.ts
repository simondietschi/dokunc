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

describe("requestCollabTicket()", () => {
  it("schickt pageId und epoch, epoch auch als null", async () => {
    const mit = fakeFetch(200, { ticket: "t1" });
    await requestCollabTicket("p1", E, mit.impl);
    expect(mit.aufrufe[0].url).toBe("/api/collab/ticket");
    expect(mit.aufrufe[0].init?.method).toBe("POST");
    expect(JSON.parse(String(mit.aufrufe[0].init?.body))).toEqual({
      pageId: "p1",
      epoch: E,
    });

    // Die Route erkennt am vorhandenen Schluessel einen Editor, der die
    // Restore-Epoche kennt. Fehlte er bei null, galte der Tab als alter
    // Code und bekaeme ohne Sitzung "Kein Zugriff" statt "neu laden".
    const ohne = fakeFetch(200, { ticket: "t2" });
    await requestCollabTicket("p1", null, ohne.impl);
    const body = JSON.parse(String(ohne.aufrufe[0].init?.body)) as object;
    expect(body).toHaveProperty("epoch", null);
  });

  it("gibt bei 200 das Ticket zurueck", async () => {
    const f = fakeFetch(200, { ticket: "t1", expiresIn: 120 });
    await expect(requestCollabTicket("p1", null, f.impl)).resolves.toEqual({
      kind: "ticket",
      ticket: "t1",
    });
  });

  it("meldet 409 mit restore-epoch als restored", async () => {
    const f = fakeFetch(409, { error: "x", code: "restore-epoch" });
    await expect(requestCollabTicket("p1", null, f.impl)).resolves.toEqual({
      kind: "restored",
    });
  });

  it("wirft bei jeder anderen Ablehnung", async () => {
    const ohneCode = fakeFetch(409, { error: "x" });
    await expect(requestCollabTicket("p1", null, ohneCode.impl)).rejects.toThrow(
      "Ticket abgelehnt (409)",
    );
    const verboten = fakeFetch(403, { error: "Kein Zugriff" });
    await expect(requestCollabTicket("p1", null, verboten.impl)).rejects.toThrow(
      "Ticket abgelehnt (403)",
    );
    const nichtAngemeldet = fakeFetch(401, { error: "Nicht angemeldet" });
    await expect(
      requestCollabTicket("p1", null, nichtAngemeldet.impl),
    ).rejects.toThrow("Ticket abgelehnt (401)");
  });
});
