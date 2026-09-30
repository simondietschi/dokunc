import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIPv4 } from "node:net";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Ergebnis, Umgebung } from "@dokunc/config";
import { prisma } from "@dokunc/db";
import { log } from "./log";

/**
 * Einrichtungs-Token für das erste Konto.
 *
 * Solange es kein Konto gibt, wird die erste Person, die sich
 * registriert oder über SSO anmeldet, Instanz-Admin. Zwischen Deploy und
 * erster Anmeldung könnte das jede Person sein, die die Instanz
 * erreicht. Deshalb legt die App bei offener Ersteinrichtung ein
 * zufälliges Token in eine Datei (Vorgabe `/app/data/setup_token`, im
 * Volume `app_data`) und nennt es einmal im Log; das erste Konto
 * entsteht nur mit diesem Token.
 *
 * Ohne Token geht es allein auf dem eigenen Rechner: APP_URL ist gesetzt
 * und zeigt auf Loopback, und jeder Name, unter dem die Anfrage die
 * Instanz anspricht, ist Loopback (Host, X-Forwarded-Host, Forwarded,
 * Origin; anfrageNamen). APP_URL allein genügte nicht: unter einer
 * öffentlichen Domain mit vergessener APP_URL=localhost (oder ohne
 * APP_URL) liefen die Server Actions weiter, weil Next nur Origin und
 * Host vergleicht. Der Host allein genügte auch nicht: ein Proxy, der
 * `Host` auf localhost umschreibt und den öffentlichen Namen in
 * X-Forwarded-Host weitergibt, sieht für ihn wie dieser Rechner aus.
 * Gibt er gar keinen Namen weiter, bleibt in einer Server Action das
 * Origin des Browsers; eine Action ohne Origin gilt darum nie als lokal
 * (NamenOptionen.aktion).
 */

export const SETUP_TOKEN_DATEI_VORGABE = "/app/data/setup_token";

/** SETUP_TOKEN_FILE: nichtleerer absoluter Pfad, leer = Vorgabe. */
export function parseSetupTokenFile(roh: string | undefined): Ergebnis<string> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: SETUP_TOKEN_DATEI_VORGABE };
  if (!isAbsolute(text)) {
    return {
      ok: false,
      fehler: `SETUP_TOKEN_FILE erwartet einen absoluten Pfad: "${roh}"`,
    };
  }
  return { ok: true, wert: text };
}

/** Datei des Tokens; ein ungültiger Wert fällt auf die Vorgabe zurück (der Start hätte ihn abgelehnt). */
export function setupTokenDatei(env: Umgebung = process.env): string {
  const r = parseSetupTokenFile(env.SETUP_TOKEN_FILE);
  return r.ok ? r.wert : SETUP_TOKEN_DATEI_VORGABE;
}

/**
 * Loopback nach RFC 6761 und 5735: `localhost`, Namen unter
 * `.localhost` (label-genau: `localhost.example.com` ist keiner),
 * 127.0.0.0/8 und `[::1]`.
 */
export function istLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "[::1]" || h === "::1") return true;
  return isIPv4(h) && h.startsWith("127.");
}

function hostnameAus(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

/** Die Header einer Anfrage: `headers()` in Actions und Seiten, `Request.headers` in Routen. */
export type AnfrageKopf = { get(name: string): string | null };

export type NamenOptionen = {
  /**
   * Die Anfrage ist eine Server Action (POST): ohne Origin gilt sie nicht
   * als lokal. Browser schicken bei jedem POST einer Action ein Origin;
   * fehlt es, ist die Anfrage von Hand gebaut, und Next lässt sie mit
   * einer Warnung durch. Hinter einem Proxy, der `Host` auf localhost
   * umschreibt und keinen Namen weitergibt, wäre sie sonst nicht von
   * einer lokalen zu unterscheiden. Seiten und der Rücksprung vom
   * Anbieter sind GET-Navigationen ohne Origin und bleiben aussen vor.
   */
  aktion?: boolean;
};

/** Liste in einem Header: an Kommas getrennt, leere Einträge fallen weg. */
function liste(wert: string | null): string[] {
  return (wert ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** `host=` aus Forwarded (RFC 7239), auch in Anführungszeichen. */
function forwardedHosts(wert: string | null): string[] {
  const hosts: string[] = [];
  for (const element of liste(wert)) {
    for (const paar of element.split(";")) {
      const gleich = paar.indexOf("=");
      if (gleich < 0) continue;
      if (paar.slice(0, gleich).trim().toLowerCase() !== "host") continue;
      let v = paar.slice(gleich + 1).trim();
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        v = v.slice(1, -1).replace(/\\(.)/g, "$1");
      }
      hosts.push(v);
    }
  }
  return hosts;
}

/**
 * Jeder Name, unter dem die Anfrage die Instanz anspricht: `Host`, jeder
 * Eintrag in X-Forwarded-Host (Next nimmt den ersten für die Prüfung der
 * Server Actions; ein späterer kann von einem weiteren Proxy stammen),
 * jedes `host=` in Forwarded und der Host aus `Origin`. `null` steht
 * für einen fehlenden `Host` oder einen Eintrag, der sich nicht lesen
 * lässt (auch `Origin: null`), in einer Server Action auch für ein
 * fehlendes Origin.
 *
 * Next setzt X-Forwarded-Host selbst auf den `Host`, wenn kein Proxy
 * ihn schickt; auf diesem Rechner ist er darum ebenfalls Loopback.
 */
export function anfrageNamen(
  kopf: AnfrageKopf | null | undefined,
  o: NamenOptionen = {},
): (string | null)[] {
  if (!kopf) return [null];
  const host = kopf.get("host");
  const namen: (string | null)[] = [host ? hostnameAus(host) : null];
  for (const h of liste(kopf.get("x-forwarded-host"))) namen.push(hostnameAus(h));
  for (const h of forwardedHosts(kopf.get("forwarded"))) namen.push(hostnameAus(h));
  const origin = kopf.get("origin")?.trim();
  if (origin) {
    try {
      namen.push(origin === "null" ? null : new URL(origin).hostname);
    } catch {
      namen.push(null);
    }
  } else if (o.aktion) {
    namen.push(null);
  }
  return namen;
}

/**
 * Braucht das erste Konto das Token? Nein nur, wenn APP_URL gesetzt ist
 * und auf Loopback zeigt und jeder Name der Anfrage (anfrageNamen)
 * Loopback ist. Eine ungültige APP_URL, ein fehlender Host oder ein
 * unlesbarer Eintrag gelten als nicht Loopback, in einer Server Action
 * auch ein fehlendes Origin.
 */
export function tokenNoetig(
  appUrl: string | undefined,
  kopf: AnfrageKopf | null | undefined,
  o: NamenOptionen = {},
): boolean {
  const roh = appUrl?.trim();
  if (!roh) return true;
  let url: URL;
  try {
    url = new URL(roh);
  } catch {
    return true;
  }
  if (!istLoopback(url.hostname)) return true;
  return anfrageNamen(kopf, o).some((n) => n === null || !istLoopback(n));
}

/** Gibt es noch kein Konto? */
export async function ersteinrichtungOffen(): Promise<boolean> {
  return (await prisma.user.findFirst({ select: { id: true } })) === null;
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/** Das Token aus der Datei, frisch gelesen (die Administration darf sie ersetzen). */
async function gespeichertesToken(): Promise<string | null> {
  try {
    const inhalt = (await readFile(setupTokenDatei(), "utf8")).trim();
    return inhalt || null;
  } catch {
    return null;
  }
}

/** Stimmt die Eingabe mit dem Token? Fehlt die Datei oder die Eingabe: nein. */
export async function checkSetupToken(eingabe: unknown): Promise<boolean> {
  const text = typeof eingabe === "string" ? eingabe.trim() : "";
  const token = await gespeichertesToken();
  if (!text || !token) return false;
  return timingSafeEqual(sha256(text), sha256(token));
}

/**
 * Fingerabdruck des Tokens für den SSO-Fluss: er steht im signierten
 * Fluss-Cookie (lib/oidc-state) und bindet das auf der Anmeldeseite
 * eingegebene Token an genau diesen `state`.
 */
export function setupFingerprint(token: string): string {
  return sha256(token.trim()).toString("base64url");
}

/** Passt der Fingerabdruck zum Token in der Datei? */
export async function checkSetupFingerprint(
  fingerabdruck: string | null | undefined,
): Promise<boolean> {
  const token = await gespeichertesToken();
  if (!fingerabdruck || !token) return false;
  return timingSafeEqual(
    sha256(fingerabdruck),
    sha256(setupFingerprint(token)),
  );
}

/** Nach dem ersten Konto: die Datei weg. Fehlt sie schon, still. */
export async function retireSetupToken(): Promise<void> {
  const datei = setupTokenDatei();
  try {
    await unlink(datei);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    log.warn({ err: e, file: datei }, "Einrichtungs-Token konnte nicht entfernt werden");
  }
}

/**
 * Das Token erscheint einmal im Log, auch mit LOG_LEVEL=error oder
 * silent: sonst fände es niemand, der die Datei nicht lesen kann. Ein
 * eigener Kindlogger hat dafür seine eigene Stufe.
 */
function tokenZeile(datei: string, token: string): void {
  log
    .child({}, { level: "info" })
    .warn(
      { file: datei, setupToken: token },
      "Ersteinrichtung offen: Das erste Konto braucht dieses Einrichtungs-Token",
    );
}

let schreibFehlerGemeldet = false;
let hinweisGemeldet = false;

export type TokenZustand = { offen: boolean; tokenBereit: boolean; datei: string };

/**
 * Legt das Token an, solange es kein Konto gibt, und räumt es danach weg.
 *
 * Datei mit `wx` und Modus 600: starten zwei Prozesse zugleich, legt
 * genau einer an, und der andere liest dessen Token. Scheitert das
 * Schreiben, bleibt die Ersteinrichtung gesperrt, ausser auf dem eigenen
 * Rechner (tokenNoetig); die Ursache steht einmal je Prozess im Log.
 *
 * `offen` lässt sich vorgeben, damit der Aufrufer die Datenbank nicht
 * zweimal fragt.
 */
export async function ensureSetupToken(
  o: { offen?: boolean } = {},
): Promise<TokenZustand> {
  const datei = setupTokenDatei();
  const offen = o.offen ?? (await ersteinrichtungOffen());
  if (!offen) {
    try {
      await unlink(datei);
      log.info({ file: datei }, "Ersteinrichtung abgeschlossen, Einrichtungs-Token entfernt");
    } catch {
      // Keine Datei: der Normalfall.
    }
    return { offen: false, tokenBereit: false, datei };
  }

  const token = randomBytes(24).toString("base64url");
  try {
    await writeFile(datei, `${token}\n`, { flag: "wx", mode: 0o600 });
    tokenZeile(datei, token);
    return { offen: true, tokenBereit: true, datei };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      if (!hinweisGemeldet) {
        hinweisGemeldet = true;
        log.warn(
          { file: datei },
          "Ersteinrichtung offen: Einrichtungs-Token liegt in der Datei",
        );
      }
      return { offen: true, tokenBereit: (await gespeichertesToken()) !== null, datei };
    }
    if (!schreibFehlerGemeldet) {
      schreibFehlerGemeldet = true;
      log.error(
        { err: e, file: datei },
        "Einrichtungs-Token konnte nicht angelegt werden — die Ersteinrichtung bleibt gesperrt, ausser über diesen Rechner (APP_URL und Aufruf auf localhost)",
      );
    }
    return { offen: true, tokenBereit: false, datei };
  }
}

export type SetupStatus =
  | { offen: false }
  | { offen: true; tokenNoetig: boolean; tokenBereit: boolean; tokenDatei: string };

/**
 * Zustand der Ersteinrichtung für Seiten und Actions, zu den Headern der
 * Anfrage (Actions mit `{ aktion: true }`). Legt das Token bei Bedarf
 * an: so entsteht es auch, wenn beim Start die Datenbank noch nicht
 * erreichbar war.
 */
export async function setupStatus(
  kopf: AnfrageKopf | null | undefined,
  o: NamenOptionen = {},
): Promise<SetupStatus> {
  if (!(await ersteinrichtungOffen())) return { offen: false };
  const zustand = await ensureSetupToken({ offen: true });
  return {
    offen: true,
    tokenNoetig: tokenNoetig(process.env.APP_URL, kopf, o),
    tokenBereit: zustand.tokenBereit,
    tokenDatei: zustand.datei,
  };
}
