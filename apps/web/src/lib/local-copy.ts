/** So lange wartet der Editor hoechstens auf seine lokale Kopie (IndexedDB). */
export const LOCAL_COPY_WAIT_MS = 3_000;

/**
 * - ohne: keine lokale Kopie (kein IndexedDB)
 * - geladen: die Kopie ist ins Y.Doc geladen
 * - zeitueberschreitung: die Kopie kam nicht binnen der Frist
 * - fehler: das Laden ist gescheitert
 */
export type LocalCopyResult = "ohne" | "geladen" | "zeitueberschreitung" | "fehler";

type Timers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

/**
 * Wartet, bis die lokale Kopie ins Y.Doc geladen ist, hoechstens waitMs.
 * Erst danach entsteht der Provider: dann gleicht er ueber SyncStep1/2 ab
 * und schickt nur, was dem Server fehlt. Ein schon verbundener Provider
 * schickte die ganze geladene Kopie als EIN Update, bei grossen Seiten
 * ueber der Nachrichtengrenze. Ohne IndexedDB (null) sofort. Rueckfall
 * nach der Frist: lieber verbinden als haengen. Lehnt nie ab.
 */
export function afterLocalCopy(
  persistence: { whenSynced: Promise<unknown> } | null,
  waitMs = LOCAL_COPY_WAIT_MS,
  timers: Timers = globalThis,
): Promise<LocalCopyResult> {
  if (!persistence) return Promise.resolve("ohne");
  return new Promise<LocalCopyResult>((resolve) => {
    let done = false;
    const finish = (result: LocalCopyResult) => {
      if (done) return;
      done = true;
      timers.clearTimeout(timer);
      resolve(result);
    };
    const timer = timers.setTimeout(
      () => finish("zeitueberschreitung"),
      waitMs,
    );
    persistence.whenSynced.then(
      () => finish("geladen"),
      () => finish("fehler"),
    );
  });
}
