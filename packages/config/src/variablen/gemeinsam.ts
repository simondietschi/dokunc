import { parseNetworkList, parseProxyHops, type NetzListe } from "../client-address";
import type { Ergebnis } from "../ergebnis";
import { parseLogLevel } from "../log";
import { effectiveSender, senderDomain, senderText, undeliverableDomain } from "../mail-absender";
import { defineVariable, type Variable } from "../variable";

/** Leer oder nur Leerraum: nicht gesetzt (null), sonst getrimmt. */
function parseMailAbsender(roh: string | undefined): Ergebnis<string | null> {
  if (roh === undefined || roh.trim() === "") return { ok: true, wert: null };
  // Ein Zeilenumbruch im Absender waere ein zusaetzlicher Kopf der Mail.
  if (/[\r\n]/.test(roh)) {
    return { ok: false, fehler: `MAIL_FROM_ADDRESS darf keinen Zeilenumbruch enthalten: ${JSON.stringify(roh)}` };
  }
  return { ok: true, wert: roh.trim() };
}

/**
 * Variablen, die die Web-App und der Collab-Server beide lesen.
 * Nach `name` sortiert (apps/web/src/konfiguration.test.ts prueft das).
 */
export const GEMEINSAME_VARIABLEN: readonly Variable[] = [
  defineVariable({
    name: "LOG_LEVEL",
    dienste: ["web", "collab"],
    beschreibung:
      "Log level of the web app and the collaboration server: fatal, error, warn, info, debug, trace or silent (case-insensitive).",
    vorgabe: "info",
    parse: parseLogLevel,
  }),
  defineVariable<string | null>({
    name: "MAIL_FROM_ADDRESS",
    dienste: ["web", "collab"],
    beschreibung:
      'Sender of invitation, password reset and notification mails, for example "Wiki <wiki@example.org>". Empty: APP_NAME and no-reply@ with the host name from APP_URL. The mail server must accept this domain as sender (SPF, DKIM).',
    vorgabe: "APP_NAME <no-reply@HOST>, HOST from APP_URL",
    parse: parseMailAbsender,
    querpruefung: {
      liest: ["SMTP_HOST", "APP_URL", "APP_NAME"],
      pruefe(wert, _werte, env) {
        // Ohne SMTP_HOST geht keine Mail hinaus (isMailConfigured() in
        // packages/mail), der Absender spielt dann keine Rolle. Nur
        // Leerraum zaehlt hier ebenso: damit kommt keine Verbindung zustande.
        const smtp = (env.SMTP_HOST ?? "").trim() !== "";
        if (wert !== null && !wert.includes("@")) {
          const meldung =
            'MAIL_FROM_ADDRESS enthaelt keine Adresse (erwartet "Name <adresse@domain>" oder "adresse@domain"): ' +
            JSON.stringify(wert);
          return smtp
            ? { fehler: [meldung] }
            : { hinweise: [`${meldung}. Ohne SMTP_HOST ungenutzt; mit SMTP_HOST bricht der Start ab.`] };
        }
        const absender = effectiveSender(env);
        const domain = senderDomain(absender);
        if (!smtp || domain === null || !undeliverableDomain(domain)) return {};
        return {
          hinweise: [
            `Mails gehen mit dem Absender "${senderText(absender)}" hinaus. Die Domain ${domain} nimmt kein ` +
              "Mailserver als Absender an: Einladungen und Passwort-Links landen im Spam oder werden abgewiesen. " +
              'MAIL_FROM_ADDRESS auf eine Adresse der eigenen Domain setzen, z. B. "Wiki <wiki@ihre-firma.ch>".',
          ],
        };
      },
    },
    // Das Startlog zeigt den Absender, den die Mails tragen, auch ohne Wert.
    anzeige: (_wert, env) => senderText(effectiveSender(env)),
  }),
  defineVariable<NetzListe>({
    name: "RATE_LIMIT_EXEMPT_NETWORKS",
    dienste: ["web", "collab"],
    beschreibung:
      "Client networks exempt from the per-address rate limits of the web app and the collaboration server (corporate NAT, VPN): IP addresses or CIDR ranges separated by commas or spaces, at most 256. Per-account limits still apply. Use the same value on every instance.",
    parse: (roh) => parseNetworkList(roh, { trenner: "komma-oder-leerraum" }),
    anzeige: (wert) => wert.eintraege,
  }),
  defineVariable<NetzListe>({
    name: "TRUSTED_PROXIES",
    // Liest vor allem der mitgelieferte Caddy (Caddyfile, trusted_proxies).
    // Web und Collab pruefen das Format beim Start, damit ein Komma die
    // App mit lesbarer Meldung anhaelt statt Caddy in einer
    // Neustartschleife, und warnen, wenn die ermittelte Client-Adresse
    // einer dieser Proxys ist (TRUSTED_PROXY_HOPS zu niedrig).
    dienste: ["proxy", "web", "collab"],
    beschreibung:
      "Upstream proxies in front of the bundled Caddy (load balancer, WAF, CDN) whose X-Forwarded-For Caddy keeps and appends to. IP addresses or CIDR ranges separated by spaces (a comma stops Caddy), or `private_ranges`. List only the proxies themselves, never client networks, and raise TRUSTED_PROXY_HOPS by one per proxy.",
    parse: (roh) => parseNetworkList(roh, { trenner: "nur-leerraum", privateRanges: true }),
    anzeige: (wert) => wert.eintraege,
  }),
  defineVariable<number>({
    name: "TRUSTED_PROXY_HOPS",
    dienste: ["web", "collab"],
    beschreibung:
      "Number of own reverse proxies in front of the app. The client address is the X-Forwarded-For entry this many positions from the right. With the bundled Caddy: 1, plus one for each proxy in front of it (listed in TRUSTED_PROXIES).",
    vorgabe: "0 (docker-compose.yml: 1)",
    parse: parseProxyHops,
    querpruefung: {
      liest: ["TRUSTED_PROXIES"],
      pruefe(wert, werte, env, dienst) {
        const hinweise: string[] = [];
        // Nur die Web-App: sie sieht keinen Socket und hat mit 0 gar
        // keine Client-Adresse. Der Collab-Server nimmt dann die
        // Gegenstelle, fuer ihn ist 0 richtig, wenn er direkt am Netz
        // haengt. Ausserhalb der Produktion (Entwicklung, Tests ohne
        // Proxy) waere die Zeile nur Rauschen.
        if (dienst === "web" && wert === 0 && env.NODE_ENV === "production") {
          hinweise.push(
            "TRUSTED_PROXY_HOPS ist 0: keine Client-Adressen. Alle Bremsen je Adresse teilen sich einen Zaehler, " +
              "Audit-Log und Sitzungsliste bleiben ohne Adresse. Hinter einem Reverse-Proxy die Zahl der eigenen " +
              "Proxys eintragen (mitgelieferter Caddy: 1, docs/admin/network.md)",
          );
        }
        const proxys = werte.TRUSTED_PROXIES as NetzListe | undefined;
        if (proxys && proxys.eintraege.length > 0 && wert < 2) {
          hinweise.push(
            `TRUSTED_PROXY_HOPS ist ${wert}, TRUSTED_PROXIES nennt aber vorgelagerte Proxys: mit dem mitgelieferten ` +
              "Caddy mindestens 2 (1 plus die Zahl der Proxys davor), sonst zaehlen alle unter der Adresse " +
              "eines Proxys (docs/admin/network.md)",
          );
        }
        return { hinweise };
      },
    },
  }),
];
