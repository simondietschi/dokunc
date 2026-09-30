import { describe, expect, it } from "vitest";
import {
  CLEAR_SITE_DATA,
  SESSION_ENDED_PATH,
  SESSION_END_RETRY_MS,
  clearSiteDataAllowed,
  loginPath,
  seeOther,
  sessionEndedPath,
  sessionCookieDroppable,
  sessionEndTarget,
  shouldCompleteSessionEnd,
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

  // So sieht die App einen RSC-Abruf: Next verbirgt `rsc` und die
  // Router-Koepfe vor headers(), Sec-Fetch und Accept bleiben.
  it("erkennt einen RSC-Abruf auch ohne den verborgenen rsc-Kopf", async () => {
    const { isDocumentRequest } = await import("./session-end");
    const rsc = { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", accept: "*/*" };
    expect(isDocumentRequest(new Headers(rsc))).toBe(false);
    expect(
      isDocumentRequest(
        new Headers({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", accept: "text/html" }),
      ),
    ).toBe(true);
    // Reines HTTP ohne Sec-Fetch-Angaben: Accept entscheidet.
    expect(isDocumentRequest(new Headers({ accept: "*/*" }))).toBe(false);
    expect(
      isDocumentRequest(new Headers({ accept: "text/html,application/xhtml+xml,*/*;q=0.8" })),
    ).toBe(true);
  });
});

describe("sessionCookieDroppable()", () => {
  const kopf = (h: Record<string, string>) => new Headers(h);
  const hier = kopf({ "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" });

  it("loescht das Cookie bei einer Navigation von hier oder ohne Sec-Fetch-Angaben", () => {
    expect(sessionCookieDroppable(hier, true)).toBe(true);
    expect(
      sessionCookieDroppable(kopf({ "sec-fetch-dest": "document", "sec-fetch-site": "none" }), true),
    ).toBe(true);
    // Reines HTTP und sehr alte Browser schicken keine Angaben.
    expect(sessionCookieDroppable(kopf({}), true)).toBe(true);
  });

  it("ohne mitgeschicktes Cookie gibt es nichts zu loeschen", () => {
    expect(sessionCookieDroppable(hier, false)).toBe(false);
    expect(sessionCookieDroppable(kopf({}), false)).toBe(false);
  });

  // Link in einer Mail: das Cookie bleibt, damit die Anmeldeseite den Weg
  // von hier aus wiederholt und der Kopf ankommt. Eine Unterressource
  // einer fremden Seite loescht es nie.
  it("nicht bei einer Anfrage von einer fremden Seite", () => {
    expect(
      sessionCookieDroppable(
        kopf({ "sec-fetch-dest": "document", "sec-fetch-site": "cross-site" }),
        true,
      ),
    ).toBe(false);
    expect(
      sessionCookieDroppable(kopf({ "sec-fetch-dest": "image", "sec-fetch-site": "cross-site" }), true),
    ).toBe(false);
  });
});

describe("shouldCompleteSessionEnd()", () => {
  const basis = {
    cookie: false,
    removedCopies: 0,
    secureContext: true,
    lastAttempt: null as number | null,
    now: 1_000_000,
  };

  it("nachholen, wenn noch ein Sitzungs-Cookie da ist oder Kopien lagen", () => {
    expect(shouldCompleteSessionEnd({ ...basis, cookie: true })).toBe(true);
    expect(shouldCompleteSessionEnd({ ...basis, removedCopies: 2 })).toBe(true);
  });

  it("nicht ohne Anlass: weder Cookie noch Kopien", () => {
    expect(shouldCompleteSessionEnd(basis)).toBe(false);
  });

  it("nicht ohne sicheren Kontext: dort wirkt der Kopf nicht", () => {
    expect(shouldCompleteSessionEnd({ ...basis, cookie: true, secureContext: false })).toBe(false);
  });

  it("hoechstens einmal je Frist", () => {
    const o = { ...basis, cookie: true };
    expect(shouldCompleteSessionEnd({ ...o, lastAttempt: o.now - 1 })).toBe(false);
    expect(
      shouldCompleteSessionEnd({ ...o, lastAttempt: o.now - SESSION_END_RETRY_MS + 1 }),
    ).toBe(false);
    expect(shouldCompleteSessionEnd({ ...o, lastAttempt: o.now - SESSION_END_RETRY_MS })).toBe(true);
    // Uhr zurueckgestellt: der Versuch zaehlt nicht.
    expect(shouldCompleteSessionEnd({ ...o, lastAttempt: o.now + 5_000 })).toBe(true);
  });
});

/**
 * Ziel und Hinweis der Anmeldeseite ueberdauern den Weg ueber
 * /session-ended: ein Mail-Link (/login?next=/notifications/<id>), der
 * Anmelde-Link einer Einladung und SSO-Fehler (/login?sso=state) fuehren
 * nach der Anmeldung sonst nach /spaces bzw. ohne Hinweis.
 */
describe("sessionEndedPath() und loginPath()", () => {
  it("ohne Ziel und Hinweis: der blosse Pfad", () => {
    expect(sessionEndedPath({})).toBe(SESSION_ENDED_PATH);
    expect(loginPath({ next: null, sso: null })).toBe("/login");
    expect(loginPath({ next: "", sso: "" })).toBe("/login");
  });

  it("ein interner Pfad als next bleibt, kodiert", () => {
    expect(sessionEndedPath({ next: "/notifications/abc" })).toBe(
      "/session-ended?next=%2Fnotifications%2Fabc",
    );
    expect(loginPath({ next: "/invite/x?t=1#a" })).toBe("/login?next=%2Finvite%2Fx%3Ft%3D1%23a");
  });

  it("ein SSO-Hinweis bleibt, zusammen mit next", () => {
    expect(loginPath({ next: "/account", sso: "state" })).toBe("/login?next=%2Faccount&sso=state");
    expect(sessionEndedPath({ sso: "no_email" })).toBe("/session-ended?sso=no_email");
  });

  // Kein offener Umleiter: was den Ursprung verlassen koennte, faellt weg.
  it("fremde oder ungueltige Ziele fallen weg", () => {
    for (const next of ["//evil.example", "https://evil.example/", "/\t/evil.example", "konto"]) {
      expect(loginPath({ next })).toBe("/login");
      expect(sessionEndedPath({ next })).toBe(SESSION_ENDED_PATH);
    }
  });

  it("ein Hinweis ist nur ein kurzes Kennwort", () => {
    for (const sso of ["<b>x</b>", "a".repeat(41), "state&next=//evil", "Fehler"]) {
      expect(loginPath({ sso })).toBe("/login");
    }
  });
});
