import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * Startpunkt fuer Hintergrundarbeit des Web-Prozesses. Next ruft
 * `register()` einmal je Serverinstanz auf, bevor die erste Anfrage
 * bedient wird.
 *
 * Hier und nicht im Collab-Prozess, obwohl der sonst die periodischen
 * Aufgaben traegt (Mailversand): das Upload-Verzeichnis gehoert dem
 * Web-Prozess. Ohne UPLOAD_DIR loest lib/uploads es relativ zu dessen
 * Arbeitsverzeichnis auf, und nur wer dieselbe Aufloesung benutzt,
 * raeumt dort, wo die Dateien liegen. Auch die Aufbewahrung
 * (lib/retention) startet hier, weil purgeTrashedTree und audit in der
 * Web-App leben.
 *
 * Nur im Node-Runtime: `register()` laeuft auch fuer die Middleware im
 * Edge-Runtime, und dort gibt es weder Dateisystem noch Prisma. Die
 * Bedingung umschliesst den dynamischen Import, damit der Edge-Build
 * das Modul gar nicht erst einbindet. Nicht waehrend `next build`: Next
 * laesst `register()` dort heute selbst aus, die eigene Pruefung haelt
 * das fest, falls sich das aendert — ein Build soll nie loeschen.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
    try {
      const { startUploadSweeper } = await import("@/lib/upload-sweeper");
      startUploadSweeper();
    } catch (e) {
      // Ein Fehler hier wuerde den Start des Servers abbrechen ("error
      // while loading instrumentation hook"). Der Aufraeumer ist das
      // nicht wert: ohne ihn bleiben Dateien liegen, ohne Server ist die
      // Instanz weg. console statt lib/log, weil gerade das Laden der
      // Module gescheitert sein kann.
      console.error("Upload-Aufraeumer konnte nicht starten:", e);
    }
    try {
      const { startRetentionJob } = await import("@/lib/retention");
      startRetentionJob();
    } catch (e) {
      console.error("Aufbewahrung konnte nicht starten:", e);
    }
  }
}
