import { describe, expect, it } from "vitest";
import { ANZEIGE_FEHLGESCHLAGEN, maskedConfig } from "../maskieren";
import { checkEnvironment } from "../pruefen";
import type { Umgebung } from "../variable";
import { GEMEINSAME_VARIABLEN } from "./gemeinsam";

/** Was das Startlog fuer MAIL_FROM_ADDRESS zeigt. */
function absenderImLog(env: Umgebung): unknown {
  const v = GEMEINSAME_VARIABLEN.find((x) => x.name === "MAIL_FROM_ADDRESS");
  if (!v) throw new Error("MAIL_FROM_ADDRESS fehlt");
  const ergebnis = v.parse(env.MAIL_FROM_ADDRESS, env);
  if (!ergebnis.ok) throw new Error(ergebnis.fehler);
  return maskedConfig([v], { MAIL_FROM_ADDRESS: ergebnis.wert }, env).MAIL_FROM_ADDRESS;
}

describe("MAIL_FROM_ADDRESS im Startlog", () => {
  // Wie fromAddress() in packages/mail: ohne Wert "dokunc <no-reply@HOST>"
  // mit dem Host aus APP_URL, sonst der Wert, wie er gesetzt ist.
  it.each([
    [{ APP_URL: "https://wiki.firma.ch/" }, "dokunc <no-reply@wiki.firma.ch>"],
    [{ APP_URL: "http://10.0.0.5:3000" }, "dokunc <no-reply@10.0.0.5>"],
    [{}, "dokunc <no-reply@localhost>"],
    [{ MAIL_FROM_ADDRESS: "Wiki <wiki@firma.ch>", APP_URL: "https://wiki.firma.ch" }, "Wiki <wiki@firma.ch>"],
  ])("zeigt fuer %j den wirksamen Absender %j", (env, erwartet) => {
    expect(absenderImLog(env)).toBe(erwartet);
  });

  it("zeigt einen leeren Wert als leer, wie ihn nodemailer bekommt", () => {
    expect(absenderImLog({ MAIL_FROM_ADDRESS: "", APP_URL: "https://wiki.firma.ch" })).toBeNull();
  });

  it("zeigt bei unbrauchbarer APP_URL, dass der Absender nicht zu bestimmen ist", () => {
    expect(absenderImLog({ APP_URL: "wiki.firma.ch" })).toBe(ANZEIGE_FEHLGESCHLAGEN);
  });
});

describe("TRUSTED_PROXY_HOPS und TRUSTED_PROXIES in der Pruefung beim Start", () => {
  const pruefe = (env: Umgebung, dienst: "web" | "collab" = "web") =>
    checkEnvironment(GEMEINSAME_VARIABLEN, env, dienst);
  const von = (befunde: { variable: string; meldung: string }[], name: string) =>
    befunde.filter((b) => b.variable === name).map((b) => b.meldung);

  it("bricht bei einer ungueltigen Zahl von Proxys ab, statt still 0 zu nehmen", () => {
    for (const dienst of ["web", "collab"] as const) {
      const r = pruefe({ TRUSTED_PROXY_HOPS: "eins" }, dienst);
      expect(r.ok, dienst).toBe(false);
      expect(von(r.fehler, "TRUSTED_PROXY_HOPS")).toEqual([
        'TRUSTED_PROXY_HOPS erwartet eine ganze Zahl von 0 bis 10: "eins"',
      ]);
    }
    expect(pruefe({ TRUSTED_PROXY_HOPS: "11" }).ok).toBe(false);
    expect(pruefe({ TRUSTED_PROXY_HOPS: " 2 " }).werte.TRUSTED_PROXY_HOPS).toBe(2);
    expect(pruefe({}).werte.TRUSTED_PROXY_HOPS).toBe(0);
  });

  it("warnt nur die Web-App in Produktion, wenn sie keine Proxys kennt", () => {
    // Ohne Proxys hat die Web-App keine Client-Adressen: alle Bremsen je
    // Adresse teilen einen Zaehler. Der Collab-Server nimmt dann die
    // Gegenstelle des Sockets, fuer ihn ist 0 kein Anlass zur Warnung.
    const web = pruefe({ NODE_ENV: "production" }, "web");
    expect(von(web.hinweise, "TRUSTED_PROXY_HOPS")).toEqual([
      expect.stringMatching(/^TRUSTED_PROXY_HOPS ist 0: keine Client-Adressen/),
    ]);
    expect(von(pruefe({ NODE_ENV: "production" }, "collab").hinweise, "TRUSTED_PROXY_HOPS")).toEqual([]);
    expect(von(pruefe({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1" }).hinweise, "TRUSTED_PROXY_HOPS")).toEqual([]);
    expect(von(pruefe({ NODE_ENV: "development" }).hinweise, "TRUSTED_PROXY_HOPS")).toEqual([]);
  });

  it("warnt, wenn TRUSTED_PROXIES gesetzt ist, TRUSTED_PROXY_HOPS aber nicht erhoeht", () => {
    // Die haeufigste Fehlanpassung: der Load Balancer ist vertraut, aber
    // die App zaehlt nur Caddy und nimmt dessen Adresse.
    for (const dienst of ["web", "collab"] as const) {
      const r = pruefe({ TRUSTED_PROXIES: "10.0.0.5", TRUSTED_PROXY_HOPS: "1" }, dienst);
      expect(r.ok).toBe(true);
      expect(von(r.hinweise, "TRUSTED_PROXY_HOPS"), dienst).toEqual([
        expect.stringContaining("mindestens 2"),
      ]);
    }
    const passend = pruefe({ TRUSTED_PROXIES: "10.0.0.5", TRUSTED_PROXY_HOPS: "2" });
    expect(von(passend.hinweise, "TRUSTED_PROXY_HOPS")).toEqual([]);
  });

  it("prueft das Format von TRUSTED_PROXIES, bevor Caddy daran scheitert", () => {
    const komma = pruefe({ TRUSTED_PROXIES: "10.0.0.5,10.0.0.6", TRUSTED_PROXY_HOPS: "2" }, "collab");
    expect(komma.ok).toBe(false);
    expect(von(komma.fehler, "TRUSTED_PROXIES")).toEqual([
      expect.stringMatching(/^TRUSTED_PROXIES: .*Leerzeichen.*Komma/),
    ]);
    const name = pruefe({ TRUSTED_PROXIES: "lb.firma.local", TRUSTED_PROXY_HOPS: "2" });
    expect(von(name.fehler, "TRUSTED_PROXIES")).toEqual([
      expect.stringContaining('Eintrag 1 "lb.firma.local"'),
    ]);
    const gut = pruefe({ TRUSTED_PROXIES: " 10.0.0.5  2001:db8::/48 ", TRUSTED_PROXY_HOPS: "2" });
    expect(gut.ok).toBe(true);
    expect(gut.hinweise).toEqual([]);
  });

  it("nimmt private_ranges wie Caddy an, mit Warnung", () => {
    const r = pruefe({ TRUSTED_PROXIES: "private_ranges", TRUSTED_PROXY_HOPS: "2" });
    expect(r.ok).toBe(true);
    expect(von(r.hinweise, "TRUSTED_PROXIES")).toEqual([
      expect.stringContaining("private_ranges"),
    ]);
  });

  it("zeigt im Startlog die Eintraege von TRUSTED_PROXIES", () => {
    const v = GEMEINSAME_VARIABLEN.find((x) => x.name === "TRUSTED_PROXIES");
    if (!v) throw new Error("TRUSTED_PROXIES fehlt");
    expect(v.dienste).toEqual(["proxy", "web", "collab"]);
    const env = { TRUSTED_PROXIES: "10.0.0.5 192.168.0.0/16" };
    const r = pruefe(env);
    expect(maskedConfig([v], r.werte, env).TRUSTED_PROXIES).toEqual([
      "10.0.0.5",
      "192.168.0.0/16",
    ]);
  });
});
