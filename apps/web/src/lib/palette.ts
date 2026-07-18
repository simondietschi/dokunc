/**
 * Reine Logik der ⌘K-Palette — vom UI getrennt, damit sie testbar ist.
 */

/**
 * Auth-Seiten haben keine Palette: Dort ist niemand angemeldet,
 * es gäbe nichts zu durchsuchen.
 */
export function isAuthPath(pathname: string): boolean {
  return /^\/(login|register|forgot|reset|invite)(\/|$)/.test(pathname);
}

/** Extrahiert den Space-Slug aus einem Pfad wie /s/engineering/p/abc. */
export function spaceSlugFromPath(pathname: string): string | null {
  const m = /^\/s\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Einfaches Token-Matching für Aktionen: Jedes Wort der Eingabe muss
 * (case-insensitiv) im Label vorkommen. Leere Eingabe matcht alles.
 */
export function matchesQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = label.toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}

/** Escaped LIKE-Metazeichen in Nutzereingaben (%, _, \). */
export function likeEscape(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Marker, mit denen ts_headline Treffer umschließt. Bewusst KEIN HTML:
 * Der Rohtext wird client-seitig sicher in React-Knoten zerlegt —
 * niemals per innerHTML gerendert (XSS).
 */
export const HL_START = "⟦"; // ⟦
export const HL_STOP = "⟧"; // ⟧

/**
 * Zerlegt einen ts_headline-Schnipsel in Segmente. `hit: true`
 * markiert die hervorzuhebenden Teile.
 */
export function splitHighlights(
  snippet: string,
): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(HL_START);
    if (start === -1) {
      out.push({ text: rest, hit: false });
      break;
    }
    if (start > 0) out.push({ text: rest.slice(0, start), hit: false });
    const stop = rest.indexOf(HL_STOP, start + 1);
    if (stop === -1) {
      // Unvollständiges Paar: Rest als Normaltext behandeln.
      out.push({ text: rest.slice(start + 1), hit: false });
      break;
    }
    out.push({ text: rest.slice(start + 1, stop), hit: true });
    rest = rest.slice(stop + 1);
  }
  return out.filter((s) => s.text.length > 0);
}
