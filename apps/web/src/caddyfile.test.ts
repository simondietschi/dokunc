import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * X-Forwarded-For im mitgelieferten Caddy.
 *
 * Die App zaehlt die Client-Adresse von rechts (TRUSTED_PROXY_HOPS). Das
 * geht nur, wenn Caddy den Header eines vorgelagerten Proxys behaelt und
 * die eigene Gegenstelle anhaengt. Mit `header_up X-Forwarded-For
 * {remote_host}` ersetzte Caddy ihn: hinter einem Load Balancer stand
 * dann immer dessen Adresse da, und alle Menschen teilten sich eine
 * Bremse. Den ganzen Weg mit echtem Caddy und vorgelagertem nginx prueft
 * der CI-Job docker (Schritt "Proxy-Kette", .github/proxy-kette); hier
 * steht, was die Konfiguration dafuer enthalten muss.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function lesen(datei: string): string {
  return readFileSync(join(ROOT, datei), "utf8");
}

/** Caddyfile ohne Kommentarzeilen. */
function caddyfile(): string {
  return lesen("Caddyfile")
    .split("\n")
    .filter((z) => !z.trim().startsWith("#"))
    .join("\n");
}

/** Der globale Optionsblock: der erste Block ohne Adresse. */
function globalerBlock(text: string): string {
  const m = /^\{\n([\s\S]*?)\n\}/m.exec(text);
  if (!m) throw new Error("globaler Block fehlt");
  return m[1];
}

type Compose = { services: Record<string, { environment?: Record<string, unknown> }> };

describe("Caddyfile und X-Forwarded-For", () => {
  it("setzt X-Forwarded-For nicht selbst", () => {
    expect(caddyfile()).not.toMatch(/header_up\s+X-Forwarded-For/i);
  });

  it("vertraut nur den Proxys aus TRUSTED_PROXIES, streng von rechts", () => {
    // Die Zeilen des servers-Blocks bis zu seiner schliessenden Klammer.
    const global = globalerBlock(caddyfile()).split("\n").map((z) => z.trim());
    const start = global.indexOf("servers {");
    const ende = global.indexOf("}", start);
    const zeilen = start < 0 ? [] : global.slice(start + 1, ende);
    expect(zeilen).toContain("trusted_proxies static {$TRUSTED_PROXIES}");
    // Ohne strict nimmt Caddy fuer {client_ip} (Zugriffslog, Matcher) den
    // linken Eintrag, also einen, den der Client geschrieben hat.
    expect(zeilen).toContain("trusted_proxies_strict");
  });

  it("reicht TRUSTED_PROXIES an den Proxy und an die App", () => {
    const compose = parse(lesen("docker-compose.yml")) as Compose;
    expect(compose.services.proxy.environment?.TRUSTED_PROXIES).toBe("${TRUSTED_PROXIES:-}");
    // Die App prueft das Format beim Start und warnt, wenn die ermittelte
    // Adresse ein vertrauter Proxy ist.
    expect(compose.services.app.environment?.TRUSTED_PROXIES).toBe("${TRUSTED_PROXIES:-}");
  });
});
