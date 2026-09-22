/**
 * Inline darstellbare Bildtypen — die EINE Quelle fuer Server und Client.
 *
 * Die Liste stand zweimal im Code: hier als MIME -> Endung fuer die
 * Speicherung (lib/uploads, api/upload, import/files) und noch einmal als
 * accept-Attribut der Dateidialoge (components/editor/upload). Zwei
 * Listen heissen: eine wird irgendwann erweitert und die andere nicht —
 * der Dialog bietet dann einen Typ an, den die Route ablehnt, oder er
 * verschweigt einen, der laengst erlaubt ist.
 *
 * Bewusst OHNE "server-only": der Dateidialog laeuft im Browser und muss
 * dieselbe Liste lesen koennen. Deshalb steht hier auch nur die Liste
 * selbst — alles, was Dateisystem oder Umgebung braucht, bleibt in
 * lib/uploads.
 */

/**
 * SVG ist bewusst ausgeschlossen (kann Skripte enthalten): eine
 * SVG-Datei wird als gewoehnlicher Anhang gespeichert und nur zum
 * Download ausgeliefert, nie inline gerendert.
 */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** True, wenn der Typ ein inline darstellbares Bild ist. */
export function isInlineImageType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, mimeType);
}

/**
 * accept-Attribut fuer Dateidialoge, aus derselben Liste abgeleitet.
 * Nur ein Hinweis an den Dateidialog — verbindlich geprueft wird an den
 * Magic Bytes in /api/upload (sniffImageType).
 */
export const IMAGE_ACCEPT = Object.keys(ALLOWED_IMAGE_TYPES).join(",");

/**
 * Schreibweise in Meldungen, wo die schlichte Grossschreibung der
 * Endung falsch waere. Alle anderen Endungen erscheinen gross ("PNG").
 */
const IMAGE_TYPE_SPELLING: Record<string, string> = { webp: "WebP" };

/**
 * Die erlaubten Bildtypen fuer Meldungstexte, z. B. "PNG, JPG, GIF und
 * WebP" — aus derselben Liste abgeleitet.
 *
 * Die Aufzaehlung stand in drei Meldungen ausgeschrieben (api/upload,
 * Upload-Toast im Editor, Import). Kaeme ein Typ hinzu, nennte keine der
 * drei ihn, und die Person erfuehre nie, dass er erlaubt ist. Endungen,
 * die mehrere MIME-Typen teilen, erscheinen nur einmal.
 */
export const IMAGE_TYPE_NAMES = (() => {
  const names = [...new Set(Object.values(ALLOWED_IMAGE_TYPES))].map(
    (ext) => IMAGE_TYPE_SPELLING[ext] ?? ext.toUpperCase(),
  );
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
})();
