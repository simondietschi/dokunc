import "server-only";
import { headers } from "next/headers";
import {
  adressMelderFuerLog,
  parseNetworkList,
  parseProxyHops,
  resolveClientAddress,
  type NetzListe,
} from "@dokunc/config";
import { log } from "./log";

/**
 * Anzahl eigener Reverse-Proxys vor der App (TRUSTED_PROXY_HOPS). 0 = die
 * App haengt direkt am Netz, dann ist X-Forwarded-For unglaubwuerdig.
 * Das mitgelieferte Compose-Setup hat genau einen Proxy (Caddy) und setzt
 * die Variable auch (siehe .env.example, docker-compose.yml).
 *
 * Steht Unsinn darin, gilt 0 (Begruendung bei parseProxyHops in
 * @dokunc/config).
 */
function proxyHops(): number {
  const r = parseProxyHops(process.env.TRUSTED_PROXY_HOPS);
  return r.ok ? r.wert : 0;
}

const LEER: NetzListe = { eintraege: [], enthaelt: () => false };

/**
 * Eine Liste von Netzen aus der Umgebung, neu gebaut nur, wenn sich der
 * Wert aendert (Tests stellen die Umgebung um). Ein ungueltiger Wert, den
 * die Pruefung beim Start abweist, gilt als leer.
 */
function netzListeAus(o: Parameters<typeof parseNetworkList>[1]) {
  let zuletzt: { roh: string | undefined; liste: NetzListe } | undefined;
  return (roh: string | undefined): NetzListe => {
    if (!zuletzt || zuletzt.roh !== roh) {
      const r = parseNetworkList(roh, o);
      zuletzt = { roh, liste: r.ok ? r.wert : LEER };
    }
    return zuletzt.liste;
  };
}

const proxyListe = netzListeAus({ trenner: "nur-leerraum", privateRanges: true });
const ausnahmeListe = netzListeAus({ trenner: "komma-oder-leerraum" });

/**
 * TRUSTED_PROXIES, die vorgelagerten Proxys vor dem mitgelieferten Caddy.
 * Die App vertraut ihnen nicht selbst (das tut Caddy); sie erkennt daran
 * nur, dass die ermittelte Adresse die eines Proxys ist und
 * TRUSTED_PROXY_HOPS zu niedrig steht.
 */
function vertrauteProxys(): NetzListe {
  return proxyListe(process.env.TRUSTED_PROXIES);
}

/**
 * Liegt die Adresse in RATE_LIMIT_EXEMPT_NETWORKS (Firmen-NAT, VPN)? Dann
 * zaehlt sie nicht fuer die Bremsen je Adresse (lib/rate-limit,
 * rateLimitByAddress); die Bremsen je Konto gelten weiter.
 */
export function isExemptAddress(
  ip: string,
  roh: string | undefined = process.env.RATE_LIMIT_EXEMPT_NETWORKS,
): boolean {
  return ausnahmeListe(roh).enthaelt(ip);
}

/**
 * Meldet gedrosselt, wenn sich aus X-Forwarded-For keine Adresse ergibt
 * oder die Adresse die eines Proxys ist (die Kette passt nicht zu
 * TRUSTED_PROXY_HOPS). Ohne die Zeile fielen alle Anfragen unbemerkt in
 * einen gemeinsamen Topf.
 */
const melder = adressMelderFuerLog((felder, meldung) => log.warn(felder, meldung));

/**
 * Client-IP der aktuellen Anfrage, oder null, wenn sich keine
 * verlaessliche ableiten laesst (keine Proxys konfiguriert, Header fehlt
 * oder ist kuerzer als die eigene Kette, massgeblicher Eintrag keine IP).
 *
 * Gezaehlt wird von rechts: vertrauenswuerdig ist nur der Eintrag, den
 * der aeusserste eigene Proxy geschrieben hat (@dokunc/config,
 * resolveClientAddress).
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const hops = proxyHops();
  const aufloesung = resolveClientAddress(
    h.get("x-forwarded-for"),
    undefined,
    hops,
    vertrauteProxys(),
  );
  melder.notiere(aufloesung, hops);
  return aufloesung.adresse;
}
