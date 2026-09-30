import { parseNetworkList, parseProxyHops, type NetzListe } from "../client-address";
import { parseLogLevel } from "../log";
import { defineVariable, type Umgebung, type Variable } from "../variable";

/**
 * Der Absender ohne MAIL_FROM_ADDRESS, wie ihn fromAddress() in
 * packages/mail/src/index.ts bildet: Host aus APP_URL. Wirft bei
 * unbrauchbarer APP_URL wie dort.
 */
function abgeleiteterAbsender(env: Umgebung): string {
  const appUrl = (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `dokunc <no-reply@${new URL(appUrl).hostname}>`;
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
      'Sender of invitation, password reset and notification mails, for example "Wiki <wiki@example.org>".',
    vorgabe: "dokunc <no-reply@HOST>, HOST from APP_URL",
    // Noch ohne eigene Regel: der Wert geht unveraendert an nodemailer
    // (packages/mail, fromAddress). Hier steht er, damit das Startlog
    // den wirksamen Absender zeigt.
    parse: (roh) => ({ ok: true, wert: roh ?? null }),
    // Das Startlog zeigt den Absender, den die Mails tragen, auch ohne
    // Wert; bei unbrauchbarer APP_URL "(Anzeige fehlgeschlagen)".
    anzeige: (wert, env) => wert ?? abgeleiteterAbsender(env),
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
