/**
 * Suchparameter einer Seite lesen.
 *
 * Next reicht einen Parameter, der mehrfach in der Adresse steht
 * (?token=a&token=b), als Liste an die Seite weiter, nicht als Text. Die
 * App erzeugt solche Adressen nie, von aussen kann sie jede Person bauen.
 * Als Text behandelt, warf eine Liste (hashToken, trim: 500 und ein
 * Fehlerlog je Aufruf) oder wurde still zu "a,b" verbunden.
 *
 * Regel fuer alle Seiten (searchParams): ein mehrfach angegebener
 * Parameter gilt als nicht angegeben. Jede Seite faellt damit auf ihren
 * Fall ohne diesen Parameter zurueck, ein Link mit Token auf seine
 * Absage. Ausnahme: die Freigabeseite (/share) lehnt einen doppelten
 * Parameter ab, auch ?page, statt auf die freigegebene Seite
 * zurueckzufallen (siehe resolveShare in lib/share.ts). Route-Handler
 * unter /api lesen ueber URLSearchParams.get() weiter den ersten Wert
 * und bekommen nie eine Liste; ausgenommen ist parseInviteFromNext
 * (lib/invitations.ts), das dieselbe Einladungsadresse liest wie die
 * Einladungsseite und deshalb genau ein Token verlangt.
 *
 * Bewusst ohne "server-only": rein und in Unit-Tests pruefbar.
 */

/**
 * Typ fuer `searchParams` jeder Seite. Die Werte sind `unknown`: so
 * meldet TypeScript jede Stelle, die einen Wert ungeprueft an Text
 * erwartende Funktionen oder Props gibt (auch `<input value={...}>`,
 * das eine Liste still zu "a,b" verbindet). Template-Literale und
 * String() prueft TypeScript nicht; dort hilft nur singleParam. Ein
 * engerer Typ wie `Promise<{ token?: string }>` verschwieg die Liste
 * ganz (src/lib/search-params.test.ts haelt den Typ fuer alle Seiten
 * fest).
 */
export type SearchParams = Promise<Record<string, unknown>>;

/** Genau ein Wert, sonst undefined (fehlt oder mehrfach angegeben). */
export function singleParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Seitenzahl aus der Adresse: nur Ziffern (hoechstens neun), mindestens 1.
 * Alles andere ("1.5", "1e300", "-2", mehrfach angegeben) ist Seite 1.
 * Ohne Grenze wurde aus ?p=1e300 ein OFFSET, den Postgres als bigint
 * ablehnt: Fehler statt Suchergebnis.
 */
export function pageNumberParam(value: unknown): number {
  const raw = singleParam(value);
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}
