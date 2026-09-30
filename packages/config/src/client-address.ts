import net from "node:net";
import type { Ergebnis } from "./ergebnis";
import { ganzeZahl } from "./variable";

/**
 * Client-Adresse aus X-Forwarded-For, gemeinsam fuer die Web-App und den
 * Collab-Server.
 *
 * Vorher stand die Logik zweimal da, und die beiden Fassungen wichen
 * voneinander ab: die Web-App packte `::ffff:a.b.c.d` nicht aus (dieselbe
 * Adresse ergab dort einen anderen Bremszaehler und einen anderen
 * Audit-Eintrag als im Collab-Server), und beide nahmen jeden beliebigen
 * Text als "Adresse", auch einen 10-KB-Wert, der dann als Schluessel in
 * Redis und als `ip` in AuditLog und Session landete.
 *
 * Nur `node:net`: der Baustein laeuft in beiden Server-Prozessen, nie im
 * Browser oder im Edge-Runtime.
 */

/** Hoechstens so viele eigene Proxys vor der App (TRUSTED_PROXY_HOPS). */
export const MAX_PROXY_HOPS = 10;

/** Laengste Form einer IP-Adresse samt Klammern und Port, grosszuegig. */
const MAX_IP_LAENGE = 64;

/**
 * TRUSTED_PROXY_HOPS: Anzahl eigener Reverse-Proxys vor der App. Leer oder
 * nicht gesetzt ergibt 0, sonst eine ganze Zahl von 0 bis 10.
 *
 * 0 und nicht 1 als Vorgabe: ein angenommener Proxy, den es nicht gibt,
 * machte den vom Client frei geschriebenen Header zur Client-Adresse. Ein
 * Angreifer bekaeme dann mit einem zufaelligen X-Forwarded-For je Anfrage
 * einen frischen Bremszaehler, und derselbe erfundene Wert landete im
 * Protokoll. Mit 0 fallen in der Web-App alle Anfragen in einen
 * gemeinsamen Topf, das bremst zu streng statt gar nicht.
 */
export const parseProxyHops: (roh: string | undefined) => Ergebnis<number> =
  (() => {
    const parse = ganzeZahl({
      min: 0,
      max: MAX_PROXY_HOPS,
      vorgabe: 0,
      name: "TRUSTED_PROXY_HOPS",
    });
    return (roh) => parse(roh, {});
  })();

/**
 * Eine Adresse, wie sie in X-Forwarded-For oder als Gegenstelle eines
 * Sockets steht, in ihre Grundform: Klammern und Port weg, Kleinschreibung,
 * `::ffff:a.b.c.d` wird zu `a.b.c.d`. `null`, wenn danach keine
 * IP-Adresse uebrig bleibt.
 *
 * Die Laenge wird vor jeder weiteren Pruefung begrenzt, damit ein
 * riesiger Header keine Arbeit macht.
 */
export function normalizeIp(value: string): string | null {
  if (value.length > MAX_IP_LAENGE) return null;
  let ip = value.trim().toLowerCase();
  if (!ip) return null;
  // IPv6 in Klammern, optional mit Port: [2001:db8::1]:443
  const inKlammern = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(ip);
  if (inKlammern) ip = inKlammern[1];
  // IPv4 mit Port (IPv6 ohne Klammern hat mehrere Doppelpunkte).
  else if (/^[\d.]+:\d{1,5}$/.test(ip)) ip = ip.slice(0, ip.indexOf(":"));
  // Node meldet IPv4-Gegenstellen an einem IPv6-Socket als
  // ::ffff:1.2.3.4, und Proxys schreiben sie teils so weiter.
  const eingebettet = /^::ffff:([\d.]+)$/.exec(ip);
  if (eingebettet && net.isIPv4(eingebettet[1])) ip = eingebettet[1];
  return net.isIP(ip) === 0 ? null : ip;
}

/**
 * Warum sich keine verlaessliche Client-Adresse ergab (Wert `reason` der
 * Logzeile; englisch, weil Log-Parser danach filtern).
 */
export type AdressProblem =
  /** TRUSTED_PROXY_HOPS > 0, aber kein X-Forwarded-For. */
  | "header_missing"
  /** Weniger Eintraege als TRUSTED_PROXY_HOPS. */
  | "header_too_short"
  /** Der massgebliche Eintrag ist keine IP-Adresse. */
  | "not_an_ip"
  /** Nur mit Socket (Collab): TRUSTED_PROXY_HOPS 0, aber der Header ist da. */
  | "hops_zero_with_header";

export type Aufloesung = {
  /** Grundform der Client-Adresse, oder `null`. */
  adresse: string | null;
  problem: AdressProblem | null;
  /** Anzahl der Eintraege in X-Forwarded-For. */
  eintraege: number;
};

function eintraegeAus(forwardedFor: string | string[] | null | undefined): string[] {
  if (!forwardedFor) return [];
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  return header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Die Client-Adresse einer Anfrage.
 *
 * X-Forwarded-For waechst von links nach rechts: ganz links steht, was der
 * Client selbst schicken durfte, ganz rechts, was der letzte Proxy
 * angehaengt hat. Verlaesslich ist nur der Eintrag, den der aeusserste
 * eigene Proxy geschrieben hat, also `hops` Positionen von rechts.
 *
 * Mit `hops` 0 zaehlt die Gegenstelle des Sockets, wenn es eine gibt
 * (Collab-Server). Die Web-App uebergibt keine: Next zeigt ihr den Socket
 * nicht, und X-Forwarded-For fuellt Next selbst mit der Gegenstelle, wenn
 * der Header fehlt; ein Client kann ihn aber vorher selbst setzen. Dort
 * ergibt 0 also keine Adresse und kein Problem.
 */
export function resolveClientAddress(
  forwardedFor: string | string[] | null | undefined,
  remoteAddress: string | undefined,
  hops: number,
): Aufloesung {
  const eintraege = eintraegeAus(forwardedFor);
  const anzahl = eintraege.length;
  if (hops <= 0) {
    const adresse = remoteAddress ? normalizeIp(remoteAddress) : null;
    const problem = adresse !== null && anzahl > 0 ? "hops_zero_with_header" : null;
    return { adresse, problem, eintraege: anzahl };
  }
  if (anzahl === 0) return { adresse: null, problem: "header_missing", eintraege: 0 };
  if (anzahl < hops) {
    return { adresse: null, problem: "header_too_short", eintraege: anzahl };
  }
  const adresse = normalizeIp(eintraege[anzahl - hops]);
  return { adresse, problem: adresse === null ? "not_an_ip" : null, eintraege: anzahl };
}

/** Was die Logzeile zu einem Problem als `hint` mitgibt (deutsch). */
export const ADRESS_HINWEIS: Record<AdressProblem, string> = {
  header_missing:
    "Anfrage ohne X-Forwarded-For bei TRUSTED_PROXY_HOPS groesser 0: erreicht jemand den Dienst am Proxy vorbei?",
  header_too_short:
    "X-Forwarded-For hat weniger Eintraege als TRUSTED_PROXY_HOPS: TRUSTED_PROXY_HOPS auf die Zahl der eigenen Proxys senken (docs/admin/network.md).",
  not_an_ip:
    "Der massgebliche Eintrag in X-Forwarded-For ist keine IP-Adresse; TRUSTED_PROXY_HOPS ist vermutlich zu hoch, dann liest die App einen vom Client geschriebenen Wert (docs/admin/network.md).",
  hops_zero_with_header:
    "X-Forwarded-For vorhanden, aber TRUSTED_PROXY_HOPS ist 0. Steht ein Proxy davor, zaehlen alle Verbindungen unter dessen Adresse (docs/admin/network.md).",
};

/** Text der Logzeile zu einem Problem. */
export function adressMeldung(problem: AdressProblem): string {
  return problem === "hops_zero_with_header"
    ? "Client-Adresse vermutlich die eines Proxys"
    : "Client-Adresse nicht bestimmbar, Anfragen zaehlen unter unknown";
}

/** Eine Zeile des AdressMelders; die Felder heissen wie im JSON-Log. */
export type AdressMeldung = {
  reason: AdressProblem;
  hops: number;
  entries: number;
  /** Treffer seit der letzten Zeile zu diesem Grund, diesen eingeschlossen. */
  count: number;
};

/**
 * Meldet Probleme bei der Client-Adresse gedrosselt, je Grund: den ersten
 * Treffer sofort, danach hoechstens alle `abstandMs` eine Zeile mit der
 * Zahl der Treffer seit der letzten. Eine Fehlanpassung trifft jede
 * Anfrage; ungedrosselt fuellte sie das Log.
 *
 * Next buendelt Route-Handler und Server Actions getrennt, ein Prozess
 * kann also mehrere Melder haben und je Grund mehr als eine Zeile im
 * Abstand schreiben.
 */
export class AdressMelder {
  private readonly stand = new Map<AdressProblem, { letzte: number; offen: number }>();

  constructor(
    private readonly melde: (z: AdressMeldung) => void,
    private readonly abstandMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  notiere(a: Aufloesung, hops: number): void {
    if (a.problem === null) return;
    const jetzt = this.now();
    const s = this.stand.get(a.problem);
    if (s && jetzt - s.letzte < this.abstandMs) {
      s.offen += 1;
      return;
    }
    const count = (s?.offen ?? 0) + 1;
    this.stand.set(a.problem, { letzte: jetzt, offen: 0 });
    this.melde({ reason: a.problem, hops, entries: a.eintraege, count });
  }
}

/**
 * Ein AdressMelder, der an ein Log schreibt: dieselbe Zeile in der
 * Web-App und im Collab-Server, mit dem Hinweis zum Grund (`hint`).
 */
export function adressMelderFuerLog(
  warn: (felder: AdressMeldung & { hint: string }, meldung: string) => void,
  abstandMs?: number,
  now?: () => number,
): AdressMelder {
  return new AdressMelder(
    (z) => warn({ ...z, hint: ADRESS_HINWEIS[z.reason] }, adressMeldung(z.reason)),
    abstandMs,
    now,
  );
}
