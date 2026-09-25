/**
 * Namen der lokalen Dokumentkopien im Browser (y-indexeddb), ohne React
 * und ohne "server-only", damit testbar.
 *
 * Ohne Restore-Epoche heisst die Kopie wie vor Punkt 10 `dokunc:<pageId>`:
 * wer nie zurueckspielt, merkt nichts, und eine ungesicherte
 * Offline-Kopie geht bei einem Update nicht verloren. Nach einem Restore
 * (scripts/restore.sh vergibt eine neue Epoche) heisst sie
 * `dokunc:<epoche>:<pageId>`. Eine Kopie von vor dem Restore wird damit
 * nie mehr geladen und bringt ihre spaeteren Yjs-Updates nicht in den
 * zurueckgespielten Stand zurueck.
 */

/** Praefix aller lokalen Dokumentkopien (y-indexeddb) von dokunc. */
export const LOCAL_DOC_PREFIX = "dokunc";

/** Name der lokalen Kopie: ohne Epoche wie bisher dokunc:<pageId>. */
export function localDocName(pageId: string, epoch: string | null): string {
  return epoch === null
    ? `${LOCAL_DOC_PREFIX}:${pageId}`
    : `${LOCAL_DOC_PREFIX}:${epoch}:${pageId}`;
}

/**
 * Zerlegt einen Namen; null, wenn er nicht von uns stammt.
 * "dokunc:<pageId>" -> { epoch: null }, "dokunc:<epoche>:<pageId>" -> { epoch },
 * anderes Praefix, leere Teile, mehr Doppelpunkte -> null.
 */
export function parseLocalDocName(
  name: string,
): { epoch: string | null; pageId: string } | null {
  const teile = name.split(":");
  if (teile[0] !== LOCAL_DOC_PREFIX) return null;
  if (teile.some((t) => t === "")) return null;
  if (teile.length === 2) return { epoch: null, pageId: teile[1] };
  if (teile.length === 3) return { epoch: teile[1], pageId: teile[2] };
  return null;
}

/**
 * Gehoert die Kopie zu einer anderen Epoche als der aktuellen? "Fremd"
 * heisst jede andere Epoche, auch null gegen gesetzt. Namen, die nicht
 * von uns stammen, sind nie fremd (sie werden nie angefasst).
 */
export function isForeignLocalDoc(name: string, epoch: string | null): boolean {
  const parsed = parseLocalDocName(name);
  return parsed !== null && parsed.epoch !== epoch;
}

type IdbFactoryLike = {
  databases?: () => Promise<Array<{ name?: string }>>;
  deleteDatabase(name: string): unknown;
};

/**
 * Loescht alle lokalen Kopien mit fremder Epoche, gibt die Namen zurueck.
 * Ohne indexedDB.databases() oder bei einem Fehler: nichts (fremde Kopien
 * werden ohnehin nie geladen). Ein anderer, veralteter Tab mit derselben
 * Kopie schliesst sie bei versionchange sofort (lib0); die Loeschung
 * wartet nicht auf ihn, seine Persistenz schreibt danach ins Leere.
 */
export async function removeForeignLocalDocs(
  epoch: string | null,
  factory: IdbFactoryLike | undefined = globalThis.indexedDB,
): Promise<string[]> {
  if (!factory || typeof factory.databases !== "function") return [];
  try {
    const dbs = await factory.databases();
    const fremde = dbs
      .map((d) => d.name)
      .filter((n): n is string => typeof n === "string")
      .filter((n) => isForeignLocalDoc(n, epoch));
    for (const name of fremde) factory.deleteDatabase(name);
    return fremde;
  } catch {
    return [];
  }
}
