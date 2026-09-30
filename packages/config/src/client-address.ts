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

/** Hoechstens so viele Eintraege in einer Liste von Netzen. */
export const MAX_NETWORK_ENTRIES = 256;

/** Eine Liste von Adressen und Netzen (TRUSTED_PROXIES, Ausnahmen). */
export type NetzListe = {
  /** Grundform der Eintraege: Adresse oder "netz/praefix". */
  readonly eintraege: readonly string[];
  /** Liegt die Adresse (beliebige Schreibweise) in einem Eintrag? */
  enthaelt(ip: string): boolean;
};

/**
 * Was Caddy unter `private_ranges` versteht (Caddy 2.11,
 * `caddy adapt` mit TRUSTED_PROXIES=private_ranges). Caddy schreibt
 * 127.0.0.1/8, gemeint ist dasselbe Netz.
 */
const PRIVATE_RANGES = [
  "192.168.0.0/16",
  "172.16.0.0/12",
  "10.0.0.0/8",
  "127.0.0.0/8",
  "fd00::/8",
  "::1",
] as const;

/** IPv4 oder IPv6 als Zahl, fuer das Maskieren eines Netzes. */
function alsZahl(ip: string, v: 4 | 6): bigint {
  if (v === 4) {
    return ip.split(".").reduce((n, t) => (n << 8n) | BigInt(Number(t)), 0n);
  }
  // Eingebettetes IPv4 am Ende (::ffff:1.2.3.4) in zwei Gruppen wandeln.
  let text = ip;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const z = alsZahl(v4[1], 4);
    text = `${text.slice(0, -v4[1].length)}${(z >> 16n).toString(16)}:${(z & 0xffffn).toString(16)}`;
  }
  const [links, rechts] = text.includes("::") ? text.split("::") : [text, undefined];
  const l = links ? links.split(":") : [];
  const r = rechts ? rechts.split(":") : [];
  const gruppen =
    rechts === undefined ? l : [...l, ...Array<string>(8 - l.length - r.length).fill("0"), ...r];
  return gruppen.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
}

/** Zahl zurueck in die kurze Schreibweise. */
function alsText(n: bigint, v: 4 | 6): string {
  if (v === 4) {
    return [24n, 16n, 8n, 0n].map((s) => String((n >> s) & 255n)).join(".");
  }
  const gruppen = Array.from({ length: 8 }, (_, i) => (n >> BigInt(112 - 16 * i)) & 0xffffn);
  // Laengste Folge von Nullgruppen (mindestens zwei) durch :: ersetzen.
  let start = -1;
  let laenge = 0;
  for (let i = 0; i < 8; ) {
    if (gruppen[i] !== 0n) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && gruppen[j] === 0n) j += 1;
    if (j - i > laenge && j - i >= 2) {
      start = i;
      laenge = j - i;
    }
    i = j;
  }
  const hex = gruppen.map((g) => g.toString(16));
  if (start < 0) return hex.join(":");
  return `${hex.slice(0, start).join(":")}::${hex.slice(start + laenge).join(":")}`;
}

/** Text fuer Meldungen: gekuerzt, damit ein langer Wert das Log nicht fuellt. */
function zitat(text: string): string {
  return JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text);
}

/**
 * Eine Liste von IPv4-/IPv6-Adressen und Netzen (Adresse/Praefix).
 *
 * - `trenner`: "komma-oder-leerraum" (Vorgabe) oder "nur-leerraum" fuer
 *   Listen, die auch Caddy liest (TRUSTED_PROXIES): Caddy trennt nur mit
 *   Leerzeichen, und ein Komma haelt ihn beim Start an.
 * - `privateRanges`: Caddys Kurzform `private_ranges` zulassen (mit
 *   Hinweis, weil sie jedem Client aus einem privaten Netz vertraut).
 *
 * Fehler: ein Eintrag, der keine Adresse ist, ein Praefix ausserhalb von
 * 0 bis 32 bzw. 128, mehr als 256 Eintraege. Hinweise: gesetzte Host-Bits
 * (das Netz gilt maskiert) und Praefix 0 (alle Adressen der Familie).
 * Nicht gesetzt oder leer ergibt eine leere Liste.
 */
export function parseNetworkList(
  roh: string | undefined,
  o: { trenner: "komma-oder-leerraum" | "nur-leerraum"; privateRanges?: boolean } = {
    trenner: "komma-oder-leerraum",
  },
): Ergebnis<NetzListe> {
  const text = (roh ?? "").trim();
  if (o.trenner === "nur-leerraum" && text.includes(",")) {
    return {
      ok: false,
      fehler: `Eintraege mit Leerzeichen trennen, nicht mit Komma (der mitgelieferte Caddy startet sonst nicht): ${zitat(text)}`,
    };
  }
  const teile = text === "" ? [] : text.split(o.trenner === "nur-leerraum" ? /\s+/ : /[\s,]+/).filter(Boolean);
  if (teile.length > MAX_NETWORK_ENTRIES) {
    return {
      ok: false,
      fehler: `hoechstens ${MAX_NETWORK_ENTRIES} Eintraege, erhalten: ${teile.length}`,
    };
  }
  const liste = new net.BlockList();
  const eintraege: string[] = [];
  const hinweise: string[] = [];
  const hinzu = (eintrag: string, nr: number): string | null => {
    const m = /^([0-9a-fA-F:.]{1,45})(?:\/(\d{1,3}))?$/.exec(eintrag);
    const adresse = m?.[1].toLowerCase() ?? "";
    const v = net.isIP(adresse);
    if (!m || (v !== 4 && v !== 6)) {
      return `Eintrag ${nr} ${zitat(eintrag)}: keine IP-Adresse und kein Netz (Adresse oder Adresse/Praefix)`;
    }
    const familie = v === 4 ? "ipv4" : "ipv6";
    if (m[2] === undefined) {
      liste.addAddress(adresse, familie);
      eintraege.push(adresse);
      return null;
    }
    const praefix = Number(m[2]);
    const max = v === 4 ? 32 : 128;
    if (praefix > max) {
      return `Eintrag ${nr} ${zitat(eintrag)}: Praefix muss zwischen 0 und ${max} liegen`;
    }
    const bits = BigInt(max);
    const maske = praefix === 0 ? 0n : ((1n << bits) - 1n) ^ ((1n << (bits - BigInt(praefix))) - 1n);
    const zahl = alsZahl(adresse, v);
    const netz = `${alsText(zahl & maske, v)}/${praefix}`;
    // Die Zahlen vergleichen, nicht die Texte: 2001:0db8::/32 ist richtig
    // maskiert und nur anders geschrieben als 2001:db8::/32.
    if ((zahl & maske) !== zahl) hinweise.push(`Eintrag ${zitat(eintrag)} gilt als ${netz}`);
    if (praefix === 0) {
      hinweise.push(`Eintrag ${zitat(eintrag)} umfasst alle ${v === 4 ? "IPv4" : "IPv6"}-Adressen`);
    }
    liste.addSubnet(adresse, praefix, familie);
    eintraege.push(netz);
    return null;
  };
  for (const [i, teil] of teile.entries()) {
    if (o.privateRanges && teil === "private_ranges") {
      hinweise.push(
        '"private_ranges" vertraut allen privaten Netzen: wer den Proxy aus einem privaten Netz direkt erreicht, kann seine Adresse selbst waehlen',
      );
      for (const r of PRIVATE_RANGES) hinzu(r, i + 1);
      continue;
    }
    const fehler = hinzu(teil, i + 1);
    if (fehler) return { ok: false, fehler };
  }
  // Derselbe Hinweis (etwa zweimal private_ranges) nur einmal.
  const einmal = [...new Set(hinweise)];
  return {
    ok: true,
    wert: {
      eintraege,
      enthaelt(ip: string) {
        const n = normalizeIp(ip);
        if (n === null) return false;
        return liste.check(n, net.isIPv4(n) ? "ipv4" : "ipv6");
      },
    },
    ...(einmal.length > 0 ? { hinweise: einmal } : {}),
  };
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
  | "hops_zero_with_header"
  /**
   * Die ermittelte Adresse steht in TRUSTED_PROXIES, und X-Forwarded-For
   * hat links von ihr noch Eintraege: TRUSTED_PROXY_HOPS vermutlich zu
   * niedrig.
   */
  | "address_is_proxy";

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
 *
 * `vertrauteProxys` (TRUSTED_PROXIES): liegt die ermittelte Adresse darin
 * und steht links von ihr noch ein Eintrag, ist sie vermutlich die eines
 * vorgelagerten Proxys, und TRUSTED_PROXY_HOPS ist zu niedrig. Die Adresse
 * bleibt, das Problem `address_is_proxy` meldet es. Ohne Eintrag links
 * davon ist sie die des Clients: umfasst TRUSTED_PROXIES auch Client-Netze
 * (private_ranges im Intranet hinter einem Load Balancer), waere der Rat,
 * TRUSTED_PROXY_HOPS zu erhoehen, falsch und schaedlich. Dann landeten
 * echte Anfragen unter unknown, und ein Client, der selbst Eintraege
 * voranstellt, waehlte seine Adresse.
 */
export function resolveClientAddress(
  forwardedFor: string | string[] | null | undefined,
  remoteAddress: string | undefined,
  hops: number,
  vertrauteProxys?: NetzListe,
): Aufloesung {
  const eintraege = eintraegeAus(forwardedFor);
  const anzahl = eintraege.length;
  // Links der gefundenen Adresse steht noch ein Eintrag: bei hops 0 jeder
  // Eintrag des Headers, sonst einer vor Position `hops` von rechts.
  const mitProxyPruefung = (a: Aufloesung): Aufloesung =>
    a.adresse !== null && anzahl > hops && vertrauteProxys?.enthaelt(a.adresse)
      ? { ...a, problem: "address_is_proxy" }
      : a;
  if (hops <= 0) {
    const adresse = remoteAddress ? normalizeIp(remoteAddress) : null;
    const problem = adresse !== null && anzahl > 0 ? "hops_zero_with_header" : null;
    return mitProxyPruefung({ adresse, problem, eintraege: anzahl });
  }
  if (anzahl === 0) return { adresse: null, problem: "header_missing", eintraege: 0 };
  if (anzahl < hops) {
    return { adresse: null, problem: "header_too_short", eintraege: anzahl };
  }
  const adresse = normalizeIp(eintraege[anzahl - hops]);
  if (adresse === null) return { adresse, problem: "not_an_ip", eintraege: anzahl };
  return mitProxyPruefung({ adresse, problem: null, eintraege: anzahl });
}

/** Was die Logzeile zu einem Problem als `hint` mitgibt (deutsch). */
export const ADRESS_HINWEIS: Record<AdressProblem, string> = {
  header_missing:
    "Anfrage ohne X-Forwarded-For bei TRUSTED_PROXY_HOPS groesser 0: erreicht jemand den Dienst am Proxy vorbei?",
  header_too_short:
    "X-Forwarded-For hat weniger Eintraege als TRUSTED_PROXY_HOPS. Mit dem mitgelieferten Caddy: die Adressen der vorgelagerten Proxys in TRUSTED_PROXIES eintragen (sonst verwirft Caddy ihren Header), sonst TRUSTED_PROXY_HOPS auf die Zahl der eigenen Proxys senken (docs/admin/network.md).",
  not_an_ip:
    "Der massgebliche Eintrag in X-Forwarded-For ist keine IP-Adresse; TRUSTED_PROXY_HOPS ist vermutlich zu hoch, dann liest die App einen vom Client geschriebenen Wert (docs/admin/network.md).",
  hops_zero_with_header:
    "X-Forwarded-For vorhanden, aber TRUSTED_PROXY_HOPS ist 0. Steht ein Proxy davor, zaehlen alle Verbindungen unter dessen Adresse (docs/admin/network.md).",
  address_is_proxy:
    "Die ermittelte Adresse steht in TRUSTED_PROXIES, und X-Forwarded-For nennt davor weitere Adressen: sie gehoert vermutlich einem vorgelagerten Proxy. Dann TRUSTED_PROXY_HOPS erhoehen (mit dem mitgelieferten Caddy 1 plus die Zahl der Proxys davor). Umfasst TRUSTED_PROXIES auch Netze von Clients (etwa private_ranges), ist es eher ein Client, der selbst X-Forwarded-For schickt: dann TRUSTED_PROXIES auf die Proxys einschraenken und TRUSTED_PROXY_HOPS lassen (docs/admin/network.md).",
};

/** Text der Logzeile zu einem Problem. */
export function adressMeldung(problem: AdressProblem): string {
  return problem === "hops_zero_with_header" || problem === "address_is_proxy"
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
