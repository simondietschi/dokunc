import { describe, expect, it } from "vitest";
import { maskedConfig } from "../maskieren";
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
  // Der Absender, den die Mails tragen (effectiveSender): ohne Wert, auch
  // leer oder nur Leerraum, "<APP_NAME> <no-reply@HOST>" mit dem Host aus
  // APP_URL, sonst der Wert, getrimmt.
  it.each([
    [{ APP_URL: "https://wiki.firma.ch/" }, "dokunc <no-reply@wiki.firma.ch>"],
    [{ APP_URL: "http://10.0.0.5:3000" }, "dokunc <no-reply@10.0.0.5>"],
    [{}, "dokunc <no-reply@localhost>"],
    [{ MAIL_FROM_ADDRESS: "", APP_URL: "https://wiki.firma.ch" }, "dokunc <no-reply@wiki.firma.ch>"],
    [{ MAIL_FROM_ADDRESS: "  ", APP_URL: "https://wiki.firma.ch" }, "dokunc <no-reply@wiki.firma.ch>"],
    [{ APP_NAME: "Firmenwiki", APP_URL: "https://wiki.firma.ch" }, "Firmenwiki <no-reply@wiki.firma.ch>"],
    [{ MAIL_FROM_ADDRESS: " Wiki <wiki@firma.ch> ", APP_URL: "https://wiki.firma.ch" }, "Wiki <wiki@firma.ch>"],
  ])("zeigt fuer %j den wirksamen Absender %j", (env, erwartet) => {
    expect(absenderImLog(env)).toBe(erwartet);
  });

  it("nimmt bei unbrauchbarer APP_URL localhost, wie die Mails", () => {
    expect(absenderImLog({ APP_URL: "wiki.firma.ch" })).toBe("dokunc <no-reply@localhost>");
  });
});

describe("MAIL_FROM_ADDRESS in der Pruefung beim Start", () => {
  const pruefe = (env: Umgebung, dienst: "web" | "collab" = "web") =>
    checkEnvironment(GEMEINSAME_VARIABLEN, env, dienst);
  const von = (befunde: { variable: string; meldung: string }[]) =>
    befunde.filter((b) => b.variable === "MAIL_FROM_ADDRESS").map((b) => b.meldung);

  it("warnt beide Server, wenn Mails mit einer Domain ohne Zustellung hinausgehen", () => {
    for (const dienst of ["web", "collab"] as const) {
      const r = pruefe(
        { SMTP_HOST: "smtp.firma.ch", MAIL_FROM_ADDRESS: "dokunc <no-reply@example.com>" },
        dienst,
      );
      expect(r.ok, dienst).toBe(true);
      expect(von(r.hinweise), dienst).toEqual([
        'MAIL_FROM_ADDRESS: Mails gehen mit dem Absender "dokunc <no-reply@example.com>" hinaus. Die Domain example.com nimmt ' +
          "kein Mailserver als Absender an: Einladungen und Passwort-Links landen im Spam oder werden " +
          'abgewiesen. MAIL_FROM_ADDRESS auf eine Adresse der eigenen Domain setzen, z. B. "Wiki <wiki@ihre-firma.ch>".',
      ]);
    }
  });

  it("warnt auch beim abgeleiteten Absender einer lokalen APP_URL", () => {
    const r = pruefe({ SMTP_HOST: "smtp.firma.ch", APP_URL: "http://localhost:3000" });
    expect(von(r.hinweise)).toEqual([expect.stringContaining('"dokunc <no-reply@localhost>"')]);
  });

  it("schweigt ohne SMTP_HOST und bei einer zustellbaren Domain", () => {
    expect(von(pruefe({ MAIL_FROM_ADDRESS: "no-reply@example.com" }).hinweise)).toEqual([]);
    expect(von(pruefe({ APP_URL: "http://localhost:3000" }).hinweise)).toEqual([]);
    const gut = pruefe({ SMTP_HOST: "smtp.firma.ch", APP_URL: "https://wiki.firma.ch" });
    expect(gut.ok).toBe(true);
    expect(von(gut.hinweise)).toEqual([]);
  });

  it("bricht mit SMTP_HOST ab, wenn der Wert keine Adresse enthaelt", () => {
    const r = pruefe({ SMTP_HOST: "smtp.firma.ch", MAIL_FROM_ADDRESS: "dokunc" });
    expect(r.ok).toBe(false);
    expect(von(r.fehler)).toEqual([
      'MAIL_FROM_ADDRESS enthaelt keine Adresse (erwartet "Name <adresse@domain>" oder "adresse@domain"): "dokunc"',
    ]);
    // Ohne SMTP_HOST verschickt niemand Mails: nur ein Hinweis.
    const ohne = pruefe({ MAIL_FROM_ADDRESS: "dokunc" });
    expect(ohne.ok).toBe(true);
    expect(von(ohne.hinweise)).toEqual([
      expect.stringMatching(/^MAIL_FROM_ADDRESS enthaelt keine Adresse .*"dokunc"\. Ohne SMTP_HOST/),
    ]);
  });

  it("bricht bei einem Zeilenumbruch ab, auch ohne SMTP_HOST", () => {
    for (const wert of ["Wiki <wiki@firma.ch>\nBcc: x@y.ch", "wiki@firma.ch\r"]) {
      const r = pruefe({ MAIL_FROM_ADDRESS: wert });
      expect(r.ok, wert).toBe(false);
      expect(von(r.fehler), wert).toEqual([
        expect.stringMatching(/^MAIL_FROM_ADDRESS darf keinen Zeilenumbruch enthalten/),
      ]);
    }
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

describe("RATE_LIMIT_EXEMPT_NETWORKS in der Pruefung beim Start", () => {
  const pruefe = (env: Umgebung, dienst: "web" | "collab" = "web") =>
    checkEnvironment(GEMEINSAME_VARIABLEN, env, dienst);
  const von = (befunde: { variable: string; meldung: string }[]) =>
    befunde.filter((b) => b.variable === "RATE_LIMIT_EXEMPT_NETWORKS").map((b) => b.meldung);

  it("gilt fuer Web und Collab und ist ohne Wert leer", () => {
    const v = GEMEINSAME_VARIABLEN.find((x) => x.name === "RATE_LIMIT_EXEMPT_NETWORKS");
    expect(v?.dienste).toEqual(["web", "collab"]);
    for (const dienst of ["web", "collab"] as const) {
      const r = pruefe({}, dienst);
      expect(r.ok).toBe(true);
      expect(maskedConfig([v!], r.werte, {}).RATE_LIMIT_EXEMPT_NETWORKS).toEqual([]);
    }
  });

  it("nimmt Komma und Leerraum und zeigt die Netze im Startlog", () => {
    const v = GEMEINSAME_VARIABLEN.find((x) => x.name === "RATE_LIMIT_EXEMPT_NETWORKS")!;
    const env = { RATE_LIMIT_EXEMPT_NETWORKS: "203.0.113.0/28, 2001:db8:42::/48 198.51.100.7" };
    const r = pruefe(env, "collab");
    expect(r.ok).toBe(true);
    expect(maskedConfig([v], r.werte, env).RATE_LIMIT_EXEMPT_NETWORKS).toEqual([
      "203.0.113.0/28",
      "2001:db8:42::/48",
      "198.51.100.7",
    ]);
  });

  it("bricht bei einem ungueltigen Eintrag ab und warnt bei Host-Bits und Praefix 0", () => {
    expect(von(pruefe({ RATE_LIMIT_EXEMPT_NETWORKS: "10.0.0.0/33" }).fehler)).toEqual([
      'RATE_LIMIT_EXEMPT_NETWORKS: Eintrag 1 "10.0.0.0/33": Praefix muss zwischen 0 und 32 liegen',
    ]);
    const r = pruefe({ RATE_LIMIT_EXEMPT_NETWORKS: "10.1.2.3/8, 0.0.0.0/0" });
    expect(r.ok).toBe(true);
    expect(von(r.hinweise)).toEqual([
      'RATE_LIMIT_EXEMPT_NETWORKS: Eintrag "10.1.2.3/8" gilt als 10.0.0.0/8',
      'RATE_LIMIT_EXEMPT_NETWORKS: Eintrag "0.0.0.0/0" umfasst alle IPv4-Adressen',
    ]);
  });
});
