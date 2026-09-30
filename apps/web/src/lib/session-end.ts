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
 *   ueber reines HTTP. Kam der Browser ohne den Kopf dorthin (weiche
 *   Navigation, Link von einer fremden Seite, Ende durch zu viele falsche
 *   Passwoerter), laedt die Seite danach einmal /session-ended
 *   (shouldCompleteSessionEnd).
 * - Der Editor loescht sie, wenn die Ticket-Route "keine Sitzung" meldet.
 */

import { safeNext } from "./safe-redirect";

/** Route, die eine beendete Sitzung im Browser abschliesst. */
export const SESSION_ENDED_PATH = "/session-ended";

/**
 * Was die Anmeldeseite ueber den Weg nach /session-ended und zurueck
 * behalten muss: das Ziel nach der Anmeldung (Mail-Link
 * /login?next=/notifications/<id>, Einladung) und den SSO-Hinweis
 * (/login?sso=state).
 */
export type LoginQuery = { next?: string | null; sso?: string | null };

/** SSO-Hinweise sind kurze Kennwoerter wie `state` oder `no_email`. */
const SSO_HINWEIS = /^[a-z_-]{1,40}$/;

/**
 * Query fuer /login und /session-ended. `next` nur als interner Pfad
 * (safeNext, sonst faellt es weg: kein offener Umleiter), `sso` nur als
 * kurzes Kennwort. Leer ohne beides.
 */
function loginQuery(q: LoginQuery): string {
  const p = new URLSearchParams();
  const next = safeNext(q.next, "");
  if (next) p.set("next", next);
  if (q.sso && SSO_HINWEIS.test(q.sso)) p.set("sso", q.sso);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** /session-ended mit dem Ziel und Hinweis der Anmeldeseite. */
export function sessionEndedPath(q: LoginQuery): string {
  return `${SESSION_ENDED_PATH}${loginQuery(q)}`;
}

/** /login mit Ziel und Hinweis, wie sie nach /session-ended kamen. */
export function loginPath(q: LoginQuery): string {
  return `/login${loginQuery(q)}`;
}

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
 * Darf GET /session-ended das Sitzungs-Cookie jetzt loeschen? Nur wenn
 * es mitkam (ein `<img src=".../session-ended">` einer fremden Seite
 * schickt unter SameSite=Lax keines, obwohl die Sitzung gueltig sein
 * kann) und wenn die Antwort `Clear-Site-Data` tragen darf oder die
 * Anfrage gar keine Sec-Fetch-Angaben hat (reines HTTP, sehr alte
 * Browser: dort wirkt der Kopf ohnehin nicht). Bei einer Navigation von
 * einer fremden Seite (Link in einer Mail) bleibt das ungueltige Cookie:
 * die Anmeldeseite sieht es und laedt /session-ended noch einmal von
 * hier aus, dann mit dem Kopf.
 */
export function sessionCookieDroppable(h: Headers, cookie: boolean): boolean {
  return cookie && (clearSiteDataAllowed(h) || !h.has("sec-fetch-site"));
}

/** Frist, in der die Anmeldeseite /session-ended nicht erneut laedt. */
export const SESSION_END_RETRY_MS = 60_000;

/**
 * Soll die Anmeldeseite (ohne gueltige Sitzung) /session-ended laden,
 * damit `Clear-Site-Data` doch noch ankommt? Ohne den Kopf kam der
 * Browser hierher, wenn noch ein Sitzungs-Cookie da ist (weiche
 * Navigation nach requireUser, Link von einer fremden Seite) oder wenn
 * gerade noch lokale Kopien lagen (Cookie und Sitzung liefen zugleich
 * ab, Ende durch zu viele falsche Passwoerter, Kopf nicht verarbeitet).
 *
 * Nur in einem sicheren Kontext (HTTPS, localhost), sonst wirkt der Kopf
 * nicht. Hoechstens einmal je Frist und Tab: schlaegt beides fehl (das
 * Cookie bleibt, der Kopf wirkt nicht), entsteht keine Schleife.
 */
export function shouldCompleteSessionEnd(o: {
  cookie: boolean;
  removedCopies: number;
  secureContext: boolean;
  lastAttempt: number | null;
  now: number;
}): boolean {
  if (!o.secureContext) return false;
  if (!o.cookie && o.removedCopies === 0) return false;
  if (o.lastAttempt === null || o.now < o.lastAttempt) return true;
  return o.now - o.lastAttempt >= SESSION_END_RETRY_MS;
}

/**
 * Ist das eine Dokumentanfrage (Seitenaufruf, Neuladen, Link von
 * aussen)? Server Actions tragen `next-action`. Den Kopf `rsc` der
 * RSC-Abrufe (weiche Navigation, Prefetch) verbirgt Next vor
 * `headers()`; erkennbar sind sie an `Sec-Fetch-Dest: empty`. Ohne
 * Sec-Fetch-Angaben (reines HTTP) entscheidet `Accept`: nur ein Dokument
 * verlangt `text/html`, ein RSC-Abruf schickt `*` + `/*`.
 */
export function isDocumentRequest(h: Headers): boolean {
  if (h.has("next-action") || h.has("rsc")) return false;
  const ziel = h.get("sec-fetch-dest");
  if (ziel !== null) return ziel === "document";
  return (h.get("accept") ?? "").includes("text/html");
}

/**
 * Wohin eine abgelaufene oder widerrufene Sitzung fuehrt. Nur eine
 * Dokumentanfrage mit (ungueltigem) Sitzungs-Cookie geht ueber
 * /session-ended: dort kommt Clear-Site-Data beim Browser an. Eine Server
 * Action oder ein RSC-Abruf darf nie auf einen Route-Handler umleiten
 * (Next holte das Ziel selbst ab, der Kopf erreichte den Browser nie);
 * sie gehen wie ohne Cookie nach /login; dort raeumt LocalDataCleanup
 * und laedt danach /session-ended als Dokument.
 */
export function sessionEndTarget(o: { document: boolean; cookie: boolean }): string {
  return o.document && o.cookie ? SESSION_ENDED_PATH : "/login";
}
