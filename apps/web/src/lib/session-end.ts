/**
 * Sitzungsende im Browser: Ziel, Antwort und Clear-Site-Data, ohne
 * "server-only" und ohne Next-Laufzeit, damit testbar.
 *
 * Ohne gueltige Sitzung gibt es keine lokalen Kopien (lib/local-doc).
 * Drei Wege setzen das durch:
 * - POST /logout und GET /session-ended schicken `Clear-Site-Data`; der
 *   Browser leert dann IndexedDB, localStorage und den HTTP-Cache der
 *   Seite (mit dem Cache auch Bilder und Dateien geschuetzter Seiten).
 *   Das gilt nur in sicheren Kontexten (HTTPS, localhost).
 * - /login loescht alle lokalen Kopien selbst (LocalDataCleanup), auch
 *   ueber reines HTTP und nach einer weichen Navigation.
 * - Der Editor loescht sie, wenn die Ticket-Route "keine Sitzung" meldet.
 */

/** Route, die eine beendete Sitzung im Browser abschliesst. */
export const SESSION_ENDED_PATH = "/session-ended";

/**
 * Wert fuer `Clear-Site-Data`: Speicher (IndexedDB, localStorage) und
 * HTTP-Cache. "cookies" fehlt bewusst: das Sitzungs-Cookie loescht die
 * Route selbst, andere Cookies gibt es nicht.
 */
export const CLEAR_SITE_DATA = '"cache", "storage"';

/**
 * 303 mit relativem Ziel und `Cache-Control: no-store`. Relativ, damit
 * ein Proxy-interner Hostname nie im `Location`-Kopf landet.
 */
export function seeOther(pfad: string, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: pfad, "Cache-Control": "no-store", ...extra },
  });
}

/**
 * Darf diese Antwort `Clear-Site-Data` tragen? Nur fuer eine
 * Dokumentnavigation, die von hier kommt oder direkt eingegeben wurde.
 * Ein `<img src=".../session-ended">` einer fremden Seite schickt unter
 * SameSite=Lax kein Cookie und saehe sonst aus wie eine beendete Sitzung.
 * Ohne die Angaben (sehr alte Browser) nie; dort raeumt /login.
 */
export function clearSiteDataAllowed(h: Headers): boolean {
  const ziel = h.get("sec-fetch-dest");
  const herkunft = h.get("sec-fetch-site");
  return ziel === "document" && (herkunft === "same-origin" || herkunft === "none");
}

/**
 * Ist das eine Dokumentanfrage? Server Actions tragen `next-action`,
 * RSC-Abrufe (weiche Navigation, Prefetch) `rsc`.
 */
export function isDocumentRequest(h: Headers): boolean {
  return !h.has("next-action") && !h.has("rsc");
}

/**
 * Wohin eine abgelaufene oder widerrufene Sitzung fuehrt. Nur eine
 * Dokumentanfrage mit (ungueltigem) Sitzungs-Cookie geht ueber
 * /session-ended: dort kommt Clear-Site-Data beim Browser an. Eine Server
 * Action oder ein RSC-Abruf darf nie auf einen Route-Handler umleiten
 * (Next holte das Ziel selbst ab, der Kopf erreichte den Browser nie);
 * sie gehen wie ohne Cookie nach /login, wo LocalDataCleanup raeumt.
 */
export function sessionEndTarget(o: { document: boolean; cookie: boolean }): string {
  return o.document && o.cookie ? SESSION_ENDED_PATH : "/login";
}
