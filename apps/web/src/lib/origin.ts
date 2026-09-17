/**
 * Same-Origin-Prüfung für state-ändernde Route-Handler (CSRF-Schutz).
 * Server Actions sind durch Next bereits geschützt; Route Handler
 * (z. B. /api/upload) brauchen das explizit.
 *
 * Fehlt der Origin-Header, wird abgelehnt — bewusst ohne Rückfall auf den
 * Host-Header: ein solcher Rückfall liesse jede Anfrage ohne Origin
 * durch, und ohne Origin kommen gerade die Aufrufe, gegen die diese
 * Prüfung steht.
 *
 * Wer entscheidet, hängt davon ab, ob APP_URL gesetzt ist:
 *
 * - IST SIE GESETZT (Produktion), entscheidet sie allein. Der
 *   Host-Header kommt dann gar nicht mehr vor — er wird vom Client
 *   geschickt, und ein zueinander passendes Paar aus Origin und Host
 *   genügte sonst, womit die APP_URL-Zeile nichts mehr entschiede. Das
 *   trug nur, solange ein vorgelagerter Proxy den Host festnagelt. Next
 *   hält es für Server Actions längst so (next.config.ts,
 *   `allowedOrigins: isProd ? appUrlHost() : …`): die Route-Handler
 *   waren damit lockerer als die Actions daneben.
 * - IST SIE NICHT GESETZT (Entwicklung, `next dev` auf localhost:3000),
 *   bleibt der Host-Header die einzige Quelle. Sonst schlüge dort jeder
 *   Upload fehl.
 *
 * Wer eine Instanz unter einem zweiten Namen erreichbar machen will,
 * muss diesen Namen in APP_URL setzen — dieselbe Bedingung, die für
 * Server Actions ohnehin schon gilt.
 */
export function isSameOrigin(
  originHeader: string | null,
  appUrl: string | undefined,
  hostHeader: string | null,
): boolean {
  if (!originHeader) return false;
  let originHost: string;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    return false;
  }

  if (appUrl) {
    try {
      return new URL(appUrl).host === originHost;
    } catch {
      // Unbrauchbare APP_URL: weiter zum Host-Header, sonst waere die
      // Instanz durch einen Tippfehler in der Konfiguration lahmgelegt.
    }
  }
  return hostHeader !== null && hostHeader === originHost;
}

/**
 * Warum die Ablehnung kam, in einem Satz fuers Log — oder null, wenn es
 * nichts zu erklaeren gibt.
 *
 * Der eine Fall, der sonst raetselhaft bleibt: die Anfrage kommt ueber
 * einen Namen, unter dem die Instanz wirklich erreichbar ist (Origin und
 * Host stimmen ueberein), aber APP_URL nennt einen anderen. Vorher ging
 * das durch, jetzt nicht mehr — und ohne diesen Hinweis suchte der
 * Betreiber den Fehler im Upload statt in einer Zeile seiner .env.
 */
export function originRejectionHint(
  originHeader: string | null,
  appUrl: string | undefined,
  hostHeader: string | null,
): string | null {
  if (!originHeader || !hostHeader || !appUrl) return null;
  let originHost: string;
  let appHost: string;
  try {
    originHost = new URL(originHeader).host;
    appHost = new URL(appUrl).host;
  } catch {
    return null;
  }
  if (originHost !== hostHeader || originHost === appHost) return null;
  return `Die Anfrage kam ueber "${originHost}", APP_URL nennt aber "${appHost}". Beide muessen denselben Namen tragen.`;
}
