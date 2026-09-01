import { isSafeFilename } from "./uploads";

/**
 * Bilder aus dem Upload-Verzeichnis in exportiertes HTML einbetten.
 *
 * Der Editor speichert hochgeladene Bilder als `/api/files/<name>` —
 * ein relativer Pfad. Im Browser (Druckansicht) funktioniert das, in
 * einem Export nicht: Gotenberg rendert das HTML ohne Basis-URL und
 * eine heruntergeladene .html-Datei wird per `file://` geöffnet. In
 * beiden Fällen fehlten die Bilder bisher ersatzlos. Deshalb werden sie
 * beim Export als data:-URI eingebettet — das Ergebnis ist wie der Rest
 * des Export-HTML self-contained.
 */

/** `src="/api/files/<name>"` in bereits generiertem HTML. */
const SRC_RE = /src="\/api\/files\/([A-Za-z0-9._-]+)"/g;

export type UploadLoader = (
  name: string,
) => Promise<{ base64: string; contentType: string } | null>;

/** Obergrenze für alle eingebetteten Bilder zusammen (base64-Zeichen). */
export const MAX_INLINE_TOTAL = 16 * 1024 * 1024;

export async function inlineUploadImages(
  html: string,
  load: UploadLoader,
  maxTotal = MAX_INLINE_TOTAL,
): Promise<string> {
  const names = new Set<string>();
  for (const m of html.matchAll(SRC_RE)) {
    if (isSafeFilename(m[1])) names.add(m[1]);
  }
  if (names.size === 0) return html;

  const replacements = new Map<string, string>();
  let budget = maxTotal;
  for (const name of names) {
    const file = await load(name).catch(() => null);
    if (!file) continue;
    if (file.base64.length > budget) continue; // zu groß: Verweis bleibt
    budget -= file.base64.length;
    replacements.set(name, `data:${file.contentType};base64,${file.base64}`);
  }

  return html.replace(SRC_RE, (match, name: string) => {
    const url = replacements.get(name);
    return url ? `src="${url}"` : match;
  });
}
