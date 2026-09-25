import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Die Bindeadressen der Compose-Dateien.
 *
 * Seit APP_BIND haengt die sichere Vorgabe (ohne .env nur Loopback, kein
 * LAN-Zugriff) allein an der Vorgabe einer Interpolation,
 * `${APP_BIND:-127.0.0.1}`. Faellt die Zeile `host_ip` weg, steht ein
 * `${APP_PORT:-7891}:443` in kurzer Schreibweise da oder eine andere
 * Vorgabe, bindet Docker still auf allen Adressen, und keine andere
 * Pruefung schluege an. Der CI-Job docker prueft die Bindung am
 * laufenden Stack (docker-compose.yml ohne .env) und die Interpolation
 * aller drei Dateien per `docker compose config`; hier stehen alle
 * Compose-Dateien des Repositorys, auch kuenftige, und der Test laeuft
 * ohne Docker.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Alle Compose-Dateien im Wurzelverzeichnis. Die override-Datei gehoert
 * dem Betreiber und nicht ins Repository (in .gitignore, s. README zu
 * COMPOSE_FILE); sie darf mit Absicht mehr oeffnen. Jede andere, auch
 * eine kuenftige, faellt unter die Regeln.
 */
const DATEIEN = readdirSync(ROOT)
  .filter((name) => /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name))
  .filter((name) => !/\.override\.ya?ml$/.test(name))
  .sort();

type Eintrag = string | Record<string, string>;

function lesen(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

function ohneAnfuehrung(wert: string): string {
  const w = wert.trim();
  return /^(["']).*\1$/.test(w) ? w.slice(1, -1) : w;
}

/**
 * Die Eintraege unter `ports:` je Dienst.
 *
 * Kein YAML-Parser im Projekt, und fuer diesen Ausschnitt braucht es
 * keinen: die Dateien nutzen fuer Ports nur Block-Listen, deren Eintraege
 * entweder eine Zeichenkette (kurze Schreibweise) oder eine Folge von
 * `schluessel: wert` sind. Alles andere (etwa `ports: [...]`) kommt als
 * Zeichenkette zurueck und faellt damit durch die Pruefung unten, statt
 * still uebersehen zu werden.
 */
function portsJeDienst(text: string): Map<string, Eintrag[]> {
  const zeilen = text
    .split("\n")
    .filter((z) => z.trim() !== "" && !z.trim().startsWith("#"))
    .map((z) => ({
      tiefe: z.length - z.trimStart().length,
      inhalt: z.trim(),
    }));
  const ergebnis = new Map<string, Eintrag[]>();

  zeilen.forEach((zeile, i) => {
    const kopf = /^ports:\s*(.*)$/.exec(zeile.inhalt);
    if (!kopf) return;
    // Der Dienst ist die naechste Zeile darueber, die weniger tief steht.
    let d = i - 1;
    while (d >= 0 && zeilen[d].tiefe >= zeile.tiefe) d--;
    const dienst = d >= 0 ? zeilen[d].inhalt.replace(/:.*$/, "") : "?";
    const eintraege = ergebnis.get(dienst) ?? [];
    ergebnis.set(dienst, eintraege);
    if (kopf[1]) {
      eintraege.push(kopf[1]);
      return;
    }
    let aktuell: Record<string, string> | null = null;
    let eintragTiefe = -1;
    for (const z of zeilen.slice(i + 1)) {
      if (z.tiefe <= zeile.tiefe) break;
      const paar = (s: string) => /^([\w-]+):\s*(.*)$/.exec(s);
      const neuerEintrag =
        z.inhalt.startsWith("- ") &&
        (eintragTiefe < 0 || z.tiefe === eintragTiefe);
      if (neuerEintrag) {
        eintragTiefe = z.tiefe;
        const rest = z.inhalt.slice(2);
        const p = paar(rest);
        if (p) {
          aktuell = { [p[1]]: ohneAnfuehrung(p[2]) };
          eintraege.push(aktuell);
        } else {
          aktuell = null;
          eintraege.push(ohneAnfuehrung(rest));
        }
        continue;
      }
      const p = paar(z.inhalt);
      if (aktuell && p && z.tiefe > eintragTiefe) {
        aktuell[p[1]] = ohneAnfuehrung(p[2]);
      } else {
        // Unerwartete Form: als Zeichenkette melden, nicht verschlucken.
        eintraege.push(z.inhalt);
      }
    }
  });
  return ergebnis;
}

/** Vorgabe mit `:-`, die auf den Loopback zeigt, IPv4 oder IPv6. */
const LOOPBACK_VORGABE = /^\$\{[A-Z][A-Z0-9_]*:-(127\.0\.0\.1|::1)\}$/;

describe("Compose-Dateien: Bindeadressen", () => {
  it("findet die Dateien, die das README nennt", () => {
    expect(DATEIEN).toEqual(
      expect.arrayContaining([
        "docker-compose.yml",
        "docker-compose.domain.yml",
        "docker-compose.ipv6.yml",
      ]),
    );
  });

  it.each(DATEIEN)("%s: nur der Proxy veroeffentlicht Ports", (name) => {
    // App, Datenbank, Redis und Gotenberg sind nur im internen Netz
    // erreichbar; ein Host-Port an ihnen umginge Proxy und TLS.
    const dienste = [...portsJeDienst(lesen(name)).keys()];
    expect(dienste.filter((d) => d !== "proxy"), name).toEqual([]);
  });

  it.each(DATEIEN)(
    "%s: jede Portzeile bindet ohne .env nur den Loopback",
    (name) => {
      const text = lesen(name);
      const eintraege = [...portsJeDienst(text).values()].flat();
      // Gegenprobe gegen den Rohtext: jede host_ip-Zeile muss in einem
      // erkannten Eintrag stecken, sonst haette der Ausschnitt oben eine
      // Form nicht verstanden und die Pruefung liefe ins Leere.
      const rohHostIps = text.match(/^\s*(-\s+)?host_ip:/gm) ?? [];
      const erkannt = eintraege.filter(
        (e) => typeof e === "object" && "host_ip" in e,
      );
      expect(erkannt.length, name).toBe(rohHostIps.length);
      for (const e of eintraege) {
        // Kurze Schreibweise ("ip:port:port" oder nur "port:port"): ohne
        // IP bindet Docker alle Adressen, und host_ip als Variable liesse
        // sich dort nicht sauber fuer IPv6 schreiben.
        expect(typeof e, `${name}: ${JSON.stringify(e)}`).toBe("object");
        const hostIp = (e as Record<string, string>).host_ip;
        expect(hostIp, `${name}: ${JSON.stringify(e)}`).toMatch(
          LOOPBACK_VORGABE,
        );
      }
    },
  );

  it("docker-compose.yml: 443 auf APP_BIND, Vorgabe 127.0.0.1", () => {
    expect(portsJeDienst(lesen("docker-compose.yml")).get("proxy")).toEqual([
      {
        target: "443",
        published: "${APP_PORT:-7891}",
        host_ip: "${APP_BIND:-127.0.0.1}",
        protocol: "tcp",
      },
    ]);
  });

  it("docker-compose.domain.yml: Port 80 auf derselben Adresse", () => {
    expect(
      portsJeDienst(lesen("docker-compose.domain.yml")).get("proxy"),
    ).toEqual([
      {
        target: "80",
        published: "80",
        host_ip: "${APP_BIND:-127.0.0.1}",
        protocol: "tcp",
      },
    ]);
  });

  it("docker-compose.ipv6.yml: 443 und 80 auf APP_BIND6, Vorgabe ::1", () => {
    // Dieselbe Regel wie fuer IPv4: wer die Datei einbindet, ohne
    // APP_BIND6 zu setzen, oeffnet nichts nach aussen.
    expect(
      portsJeDienst(lesen("docker-compose.ipv6.yml")).get("proxy"),
    ).toEqual([
      {
        target: "443",
        published: "${APP_PORT:-7891}",
        host_ip: "${APP_BIND6:-::1}",
        protocol: "tcp",
      },
      {
        target: "80",
        published: "80",
        host_ip: "${APP_BIND6:-::1}",
        protocol: "tcp",
      },
    ]);
  });
});

describe("portsJeDienst()", () => {
  // Der Ausschnitt-Parser selbst: er darf eine gefaehrliche Form nicht
  // uebersehen, sonst waeren die Pruefungen oben wertlos.
  it("meldet die kurze Schreibweise als Zeichenkette", () => {
    const text = [
      "services:",
      "  proxy:",
      "    ports:",
      '      - "127.0.0.1:${APP_PORT:-7891}:443"',
      "  app:",
      "    expose:",
      '      - "3000"',
    ].join("\n");
    expect(portsJeDienst(text)).toEqual(
      new Map([["proxy", ["127.0.0.1:${APP_PORT:-7891}:443"]]]),
    );
  });

  it("meldet eine Flow-Liste als Zeichenkette", () => {
    const text = ["services:", "  db:", '    ports: ["5432:5432"]'].join("\n");
    expect(portsJeDienst(text).get("db")).toEqual(['["5432:5432"]']);
  });

  it("liest die lange Schreibweise, auch ohne host_ip", () => {
    const text = [
      "services:",
      "  proxy:",
      "    ports:",
      "      # Kommentar",
      "      - target: 443",
      '        published: "7891"',
      "      - target: 80",
      "        host_ip: '${X:-::1}'",
      "    volumes:",
      "      - data:/data",
    ].join("\n");
    expect(portsJeDienst(text).get("proxy")).toEqual([
      { target: "443", published: "7891" },
      { target: "80", host_ip: "${X:-::1}" },
    ]);
  });
});

describe("Caddy: TLS ueber CADDY_TLS", () => {
  // Wer fuer eine eigene Domain die Caddyfile aendern muss, stoesst bei
  // jedem Update auf einen Konflikt. Deshalb kommt die TLS-Quelle aus der
  // Umgebung, und beide Enden brauchen die Vorgabe `internal`: ohne sie
  // in der Caddyfile bricht Caddy an einer leeren Direktive ab, ohne sie
  // in docker-compose.yml kaeme ein leerer Eintrag `CADDY_TLS=` der .env
  // durch (leer ist nicht dasselbe wie nicht gesetzt).
  it("Caddyfile liest die TLS-Quelle aus CADDY_TLS, Vorgabe internal", () => {
    const direktiven = lesen("Caddyfile")
      .split("\n")
      .map((z) => z.trim())
      .filter((z) => /^tls(\s|$)/.test(z));
    expect(direktiven).toEqual(["tls {$CADDY_TLS:internal}"]);
  });

  it("docker-compose.yml reicht CADDY_TLS mit Vorgabe internal durch", () => {
    const zeilen = lesen("docker-compose.yml")
      .split("\n")
      .map((z) => z.trim())
      .filter((z) => z.startsWith("CADDY_TLS:"));
    expect(zeilen).toEqual(["CADDY_TLS: ${CADDY_TLS:-internal}"]);
  });
});
