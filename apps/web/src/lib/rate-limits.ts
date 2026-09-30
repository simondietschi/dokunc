/**
 * Alle Bremsen der Anwendung an einer Stelle.
 *
 * Sie standen als nackte Zahlenpaare im Aufruf: `rateLimit(key, 20, 3600)`.
 * Zwei Probleme daran. Erstens sagt das Paar nicht, welche Haelfte die
 * Versuche und welche das Fenster ist — `(5, 900)` und `(10, 900)` stehen
 * in derselben Datei untereinander. Zweitens kam dasselbe Paar (20, 3600)
 * zweimal vor, fuer die KI-Frage und fuer Einladungen, also fuer voellig
 * Verschiedenes: Kosten beim Anbieter gegen Mailversand. Wer eine davon
 * aendern wollte, musste erst herausfinden, welche er vor sich hat.
 *
 * Hier steht jede Bremse einmal, mit dem Grund daneben. Der Nebeneffekt
 * ist die eigentliche Absicht: die gesamte Politik ist auf einem
 * Bildschirm zu lesen und zu vergleichen, statt ueber neun Routen und
 * vier Server-Actions verteilt.
 *
 * `fenster` ist immer in Sekunden.
 *
 * Die Bremsen je Adresse und die Upload-Bremse lassen sich per Umgebung
 * einstellen (BREMSEN_AUS_DER_UMGEBUNG): hinter einer Firmen-NAT teilen
 * sich viele Menschen eine Adresse. Alle anderen stehen fest.
 */

import type { Ergebnis } from "@dokunc/config";

export type Bremse = { versuche: number; fenster: number };

/** Vorgaben aller Bremsen (Dokumentation und Rueckfall). */
export const RATE_LIMIT_VORGABEN = {
  /** KI-Frage ueber den ganzen Bestand: begrenzt die Kosten beim Anbieter. */
  ask: { versuche: 20, fenster: 3600 },
  /** Textbefehle im Editor: dieselbe Kostenfrage, aber kleinere Antworten. */
  aiAssist: { versuche: 30, fenster: 3600 },

  /** Einladung in einen Space: begrenzt den Mailversand je Konto. */
  invite: { versuche: 20, fenster: 3600 },

  /**
   * Passwort zuruecksetzen, pro IP. Getrennt, weil die beiden Schritte
   * Verschiedenes kosten: das Anfordern verschickt eine Mail, das
   * Einloesen raet an einem Token.
   */
  resetRequest: { versuche: 5, fenster: 900 },
  resetSubmit: { versuche: 10, fenster: 900 },

  /**
   * Anmeldung ueber einen fremden Anbieter, pro IP. 600 je Stunde: ein
   * Standort mit 500 Menschen hinter einer NAT-Adresse meldet sich morgens
   * binnen Minuten an. Ein Start kostet nur eine Weiterleitung; raten
   * laesst sich hier nichts.
   */
  oidcStart: { versuche: 600, fenster: 3600 },

  /**
   * Collab-Ticket: eines je Verbindungsaufbau. Grosszuegig, weil ein
   * wackliges Netz den Editor sonst aussperrt.
   */
  collabTicket: { versuche: 120, fenster: 60 },
  /** Suche: laeuft beim Tippen, deshalb dieselbe Groessenordnung. */
  search: { versuche: 120, fenster: 60 },
  /** Vorschlaege in der Palette: feuert noch dichter als die Suche. */
  suggest: { versuche: 240, fenster: 60 },
  /**
   * Titel der Wiki-Link-Ziele im Editor, je Konto. Eine Seite fragt beim
   * Oeffnen hoechstens einmal je 100 Links (die meisten kennt sie schon
   * aus der Vorbelegung); die Grenze trifft nur, wer IDs in Schleife
   * durchprobiert.
   */
  pageTitles: { versuche: 120, fenster: 60 },

  /** Upload je Konto: begrenzt, wie schnell die Platte vollaeuft. */
  upload: { versuche: 30, fenster: 60 },
  /** Import: jeder Lauf kann bis zu 2000 Seiten anlegen. */
  import: { versuche: 5, fenster: 600 },
  /** PDF-Export: jeder Lauf startet einen Browser. */
  exportPdf: { versuche: 10, fenster: 600 },
  /** Offene Benachrichtigungsstroeme je Konto. */
  notifyStream: { versuche: 30, fenster: 60 },

  /**
   * Anmeldung. Zwei Bremsen nebeneinander, und beide werden gebraucht:
   * die pro Konto (streng) gegen das Raten eines Passworts, die pro IP
   * (grosszuegiger) gegen das breite Durchprobieren vieler Konten — hinter
   * einem Firmenanschluss teilen sich viele Menschen eine Adresse.
   *
   * Bewusst ein ablaufendes Fenster und keine harte Sperre: eine echte
   * Sperre liesse sich missbrauchen, um fremde Konten gezielt
   * auszusperren. Gezaehlt wird jeder Versuch, aber ein erfolgreicher
   * Login raeumt den Zaehler sofort — sonst sperrte sich aus, wer sich an
   * mehreren Geraeten anmeldet.
   */
  login: { versuche: 8, fenster: 900 },
  loginIp: { versuche: 30, fenster: 300 },
  /** Registrierung pro IP. */
  register: { versuche: 10, fenster: 600 },
  /** Zweiter Faktor: Code beim Einrichten bestaetigen. */
  totpConfirm: { versuche: 10, fenster: 600 },
  /**
   * Passwort bestaetigen (Passwort aendern, Konto loeschen, Zwei-Faktor
   * abschalten, neue Codes): EIN Zaehler je Konto ueber alle vier Stellen
   * und alle Sitzungen (lib/reauth).
   */
  reauth: { versuche: 10, fenster: 600 },
} as const satisfies Record<string, Bremse>;

export type BremsName = keyof typeof RATE_LIMIT_VORGABEN;

/**
 * Per Umgebung einstellbar: Schluessel -> Variable. Nur Bremsen, bei denen
 * Betreiber einen Grund zum Anpassen haben (viele Menschen hinter einer
 * Adresse, Menge der Uploads); die Sicherheitsbremsen je Konto bleiben
 * fest. Deklariert in
 * lib/config/variablen.ts.
 */
export const BREMSEN_AUS_DER_UMGEBUNG = {
  oidcStart: "RATE_LIMIT_SSO_START_PER_IP",
  loginIp: "RATE_LIMIT_LOGIN_PER_IP",
  register: "RATE_LIMIT_REGISTER_PER_IP",
  resetRequest: "RATE_LIMIT_RESET_REQUEST_PER_IP",
  resetSubmit: "RATE_LIMIT_RESET_SUBMIT_PER_IP",
  upload: "RATE_LIMIT_UPLOAD_PER_USER",
} as const satisfies Partial<Record<BremsName, string>>;

const HOECHSTENS_VERSUCHE = 100_000;
const HOECHSTENS_FENSTER = 24 * 3600;
const EINHEIT: Record<string, number> = { s: 1, m: 60, h: 3600 };

/**
 * Eine Bremse aus der Umgebung: "Versuche/Fenster", Fenster in Sekunden
 * oder mit Einheit s, m, h ("600/1h", "30/300", "5/15m"), Gross/klein
 * egal. Versuche 1 bis 100000, Fenster 1 s bis 24 h. Leer oder nicht
 * gesetzt ergibt null, also die Vorgabe.
 */
export function parseRateLimitSpec(roh: string | undefined): Ergebnis<Bremse | null> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: null };
  const m = /^(\d{1,6})\s*\/\s*(\d{1,5})\s*([smh])?$/i.exec(text);
  const versuche = m ? Number(m[1]) : 0;
  const fenster = m ? Number(m[2]) * EINHEIT[(m[3] ?? "s").toLowerCase()] : 0;
  if (
    !m ||
    versuche < 1 ||
    versuche > HOECHSTENS_VERSUCHE ||
    fenster < 1 ||
    fenster > HOECHSTENS_FENSTER
  ) {
    const gekuerzt = text.length > 40 ? `${text.slice(0, 40)}…` : (roh ?? "");
    return {
      ok: false,
      fehler: `erwartet Versuche/Fenster wie "30/5m" (Versuche 1 bis 100000, Fenster in s, m oder h, hoechstens 24h), erhalten: "${gekuerzt}"`,
    };
  }
  return { ok: true, wert: { versuche, fenster } };
}

/**
 * Die Bremse, die gilt: der Wert aus der Umgebung, wenn die Bremse
 * einstellbar und der Wert gueltig ist, sonst die Vorgabe. Einen
 * ungueltigen Wert haelt die Pruefung beim Start auf.
 */
export function wirksameBremse(
  name: BremsName,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Bremse {
  const variable = (BREMSEN_AUS_DER_UMGEBUNG as Partial<Record<BremsName, string>>)[name];
  if (variable) {
    const r = parseRateLimitSpec(env[variable]);
    if (r.ok && r.wert) return r.wert;
  }
  return RATE_LIMIT_VORGABEN[name];
}

/**
 * Die Bremsen, wie die Aufrufer sie lesen (`RATE_LIMITS.loginIp.versuche`).
 * Jeder Zugriff liest die Umgebung neu: das Parsen eines kurzen Texts
 * kostet nichts, kein Aufruf kann die Einstellung umgehen, und Tests
 * koennen sie umstellen.
 */
export const RATE_LIMITS: { readonly [K in BremsName]: Bremse } = Object.defineProperties(
  {},
  Object.fromEntries(
    (Object.keys(RATE_LIMIT_VORGABEN) as BremsName[]).map((name) => [
      name,
      { enumerable: true, get: () => wirksameBremse(name) },
    ]),
  ),
) as { readonly [K in BremsName]: Bremse };
