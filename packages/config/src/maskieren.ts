import type { Umgebung, Variable } from "./variable";

/** Laengere Werte kuerzt das Startlog (etwa lange Listen). */
export const MAX_ANZEIGE = 200;

/** Steht im Startlog statt des Werts, wenn die Anzeige einer Variable wirft. */
export const ANZEIGE_FEHLGESCHLAGEN = "(Anzeige fehlgeschlagen)";

/** Ersetzt das Passwort einer URL durch ***; andere Texte bleiben. */
function ohneUrlPasswort(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return text;
  }
  if (url.password === "") return text;
  url.password = "***";
  return url.href;
}

function kuerzen(text: string): string {
  return text.length > MAX_ANZEIGE ? `${text.slice(0, MAX_ANZEIGE)}…` : text;
}

function tief(wert: unknown): unknown {
  if (typeof wert === "string") return ohneUrlPasswort(wert);
  if (Array.isArray(wert)) return wert.map(tief);
  if (wert && typeof wert === "object") {
    return Object.fromEntries(Object.entries(wert).map(([k, w]) => [k, tief(w)]));
  }
  return wert;
}

/**
 * Wert fuer das Startlog.
 *
 * - geheim: "***", leer oder nicht gesetzt: null;
 * - Text, der als URL mit Passwort parst: Passwort durch *** ersetzt
 *   (postgresql://dokunc:***@db:5432/dokunc), auch in Listen und Objekten;
 * - ueber MAX_ANZEIGE Zeichen gekuerzt, Listen und Objekte dann als
 *   gekuerzter JSON-Text.
 */
export function maskValue(wert: unknown, geheim = false): unknown {
  if (wert === undefined || wert === null || wert === "") return null;
  if (geheim) return "***";
  const sauber = tief(wert);
  if (typeof sauber === "string") return kuerzen(sauber);
  if (typeof sauber === "object") {
    const json = JSON.stringify(sauber);
    return json.length > MAX_ANZEIGE ? kuerzen(json) : sauber;
  }
  return sauber;
}

/**
 * Die wirksame Konfiguration fuer das Startlog, je Variable maskiert.
 *
 * Wirft die Anzeige einer Variable, steht dort ANZEIGE_FEHLGESCHLAGEN
 * (bei geheimen "***"), und die anderen Variablen erscheinen wie sonst:
 * die Anzeige dient nur dem Log und darf den Start nicht aufhalten. Die
 * Meldung des Fehlers erscheint nicht, sie koennte Werte enthalten.
 */
export function maskedConfig(
  variablen: readonly Variable[],
  werte: Readonly<Record<string, unknown>>,
  env: Umgebung,
): Record<string, unknown> {
  const aus: Record<string, unknown> = {};
  for (const v of variablen) {
    if (!(v.name in werte)) continue;
    let wert: unknown;
    try {
      wert = v.anzeige ? v.anzeige(werte[v.name], env) : werte[v.name];
    } catch {
      aus[v.name] = v.geheim ? "***" : ANZEIGE_FEHLGESCHLAGEN;
      continue;
    }
    aus[v.name] = maskValue(wert, v.geheim);
  }
  return aus;
}
