import { describe, expect, it } from "vitest";
import {
  CLEAR_SITE_DATA,
  SESSION_ENDED_PATH,
  clearSiteDataAllowed,
  seeOther,
  sessionEndTarget,
} from "./session-end";

describe("seeOther()", () => {
  it("303 mit relativem Ziel, nicht zwischengespeichert, mit weiteren Koepfen", () => {
    const r = seeOther("/login", { "Clear-Site-Data": CLEAR_SITE_DATA });
    expect(r.status).toBe(303);
    // Relativ: ein Proxy-interner Hostname landet nie im Location-Kopf.
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("clear-site-data")).toBe('"cache", "storage"');
  });
});

describe("clearSiteDataAllowed()", () => {
  const kopf = (h: Record<string, string>) => new Headers(h);

  it("nur fuer eine Dokumentnavigation von hier oder direkt eingegeben", () => {
    expect(
      clearSiteDataAllowed(kopf({ "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" })),
    ).toBe(true);
    expect(
      clearSiteDataAllowed(kopf({ "sec-fetch-dest": "document", "sec-fetch-site": "none" })),
    ).toBe(true);
  });

  // Ein <img src=".../session-ended"> einer fremden Seite schickt kein
  // Cookie (SameSite=Lax) und saehe aus wie eine beendete Sitzung.
  it("nie fuer fremde Seiten, Unterressourcen oder ohne Angaben", () => {
    expect(
      clearSiteDataAllowed(kopf({ "sec-fetch-dest": "image", "sec-fetch-site": "cross-site" })),
    ).toBe(false);
    expect(
      clearSiteDataAllowed(kopf({ "sec-fetch-dest": "document", "sec-fetch-site": "cross-site" })),
    ).toBe(false);
    expect(
      clearSiteDataAllowed(kopf({ "sec-fetch-dest": "document", "sec-fetch-site": "same-site" })),
    ).toBe(false);
    expect(
      clearSiteDataAllowed(kopf({ "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin" })),
    ).toBe(false);
    expect(clearSiteDataAllowed(kopf({}))).toBe(false);
  });
});

describe("sessionEndTarget()", () => {
  // Eine Server Action darf nie auf einen Route-Handler umleiten: Next
  // holt das Ziel selbst ab, Clear-Site-Data erreichte den Browser nie,
  // und die Adresszeile zeigte /session-ended mit dem Inhalt von /login.
  it("nur eine Dokumentanfrage mit Sitzungs-Cookie geht ueber /session-ended", () => {
    expect(sessionEndTarget({ document: true, cookie: true })).toBe(SESSION_ENDED_PATH);
    expect(sessionEndTarget({ document: true, cookie: false })).toBe("/login");
    expect(sessionEndTarget({ document: false, cookie: true })).toBe("/login");
    expect(sessionEndTarget({ document: false, cookie: false })).toBe("/login");
  });

  it("erkennt Server Actions und RSC-Abrufe an ihren Koepfen", async () => {
    const { isDocumentRequest } = await import("./session-end");
    expect(isDocumentRequest(new Headers({ accept: "text/html" }))).toBe(true);
    expect(isDocumentRequest(new Headers({ "next-action": "abc" }))).toBe(false);
    expect(isDocumentRequest(new Headers({ rsc: "1" }))).toBe(false);
  });
});
