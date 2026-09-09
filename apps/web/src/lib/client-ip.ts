import "server-only";
import { headers } from "next/headers";

/**
 * Anzahl eigener Reverse-Proxys vor der App. 0 = die App haengt direkt
 * am Netz, dann ist X-Forwarded-For komplett unglaubwuerdig.
 * Das mitgelieferte Compose-Setup hat genau einen Proxy (Caddy).
 */
export function trustedProxyHops(
  raw: string | undefined = process.env.TRUSTED_PROXY_HOPS,
): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/**
 * Ermittelt die Client-IP aus X-Forwarded-For.
 *
 * Der Header ist eine Liste, die von links nach rechts waechst: ganz
 * links steht, was der Client selbst schicken durfte, ganz rechts, was
 * der letzte Proxy angehaengt hat. Der erste Eintrag ist also frei
 * faelschbar — genau darauf hat die alte Implementierung gehoert.
 * Vertrauenswuerdig ist nur der Eintrag, den der aeusserste eigene
 * Proxy geschrieben hat: `laenge - hops`.
 *
 * Gibt null zurueck, wenn kein verlaesslicher Wert ableitbar ist
 * (keine Proxys konfiguriert, Header fehlt, oder die Liste ist kuerzer
 * als die eigene Infrastruktur sie machen wuerde).
 */
export function clientIpFrom(
  forwardedFor: string | null | undefined,
  hops: number,
): string | null {
  if (hops <= 0 || !forwardedFor) return null;
  const parts = forwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < hops) return null;
  return normalizeIp(parts[parts.length - hops]);
}

/** Klammern und Port entfernen, damit derselbe Peer denselben Schluessel ergibt. */
export function normalizeIp(value: string): string | null {
  let ip = value.trim().toLowerCase();
  if (!ip) return null;
  // IPv6 in Klammern, optional mit Port: [::1]:443
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  // IPv4 mit Port (IPv6 ohne Klammern enthaelt mehrere Doppelpunkte).
  const colons = ip.split(":").length - 1;
  if (colons === 1) ip = ip.split(":")[0];
  return ip || null;
}

/** Client-IP der aktuellen Anfrage, oder null wenn nicht vertrauenswuerdig. */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return clientIpFrom(h.get("x-forwarded-for"), trustedProxyHops());
}
