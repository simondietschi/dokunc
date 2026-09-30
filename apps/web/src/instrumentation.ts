import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * Startpunkt des Web-Prozesses: Pruefung der Konfiguration und
 * Hintergrundarbeit. Next ruft `register()` einmal je Serverinstanz auf,
 * bevor die erste Anfrage bedient wird.
 *
 * Die Hintergrundarbeit hier und nicht im Collab-Prozess, obwohl der sonst die periodischen
 * Aufgaben traegt (Mailversand): das Upload-Verzeichnis gehoert dem
 * Web-Prozess. Ohne UPLOAD_DIR loest lib/uploads es relativ zu dessen
 * Arbeitsverzeichnis auf, und nur wer dieselbe Aufloesung benutzt,
 * raeumt dort, wo die Dateien liegen. Auch die Aufbewahrung
 * (lib/retention) startet hier, weil purgeTrashedTree und audit in der
 * Web-App leben.
 *
 * Nur im Node-Runtime: `register()` laeuft auch fuer die Middleware im
 * Edge-Runtime, und dort gibt es weder Dateisystem noch Prisma. Die
 * Bedingung umschliesst die dynamischen Importe, damit der Edge-Build
 * die Module gar nicht erst einbindet. Nicht waehrend `next build`: Next
 * laesst `register()` dort heute selbst aus, die eigene Pruefung haelt
 * das fest, falls sich das aendert — ein Build soll nie loeschen.
 *
 * Die Reihenfolge ist fest; wer etwas beim Start braucht, haengt sich an
 * seiner Stelle ein:
 *  1. Logging (Konsole, Node-Warnungen, Datenbank-Log in das JSON-Log);
 *  2. Pruefung der Konfiguration. Bei einem Fehler endet der Prozess mit
 *     Code 78, bevor irgendetwas anderes startet; Warnungen zu einzelnen
 *     Werten laufen als Hinweise der Pruefung mit, nicht als eigene
 *     Aufrufe hier;
 *  3. einmalige Startaufgaben;
 *  4. Hintergrundjobs.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;

    // 2. Konfiguration. Kein try/catch wie bei den Jobs: scheitert schon
    // das Laden der Pruefung, soll das nicht still untergehen. Bei
    // ungueltigen Werten beendet checkWebConfig den Prozess selbst, weil
    // Next einen Wurf aus register() nur meldet und weiterlaeuft.
    const { checkWebConfig } = await import("@/lib/config");
    checkWebConfig();

    // 3. Einmalige Startaufgaben. Das Einrichtungs-Token entsteht, solange
    // es kein Konto gibt (lib/setup-token). Ohne await: eine langsame oder
    // noch nicht erreichbare Datenbank soll den Start nicht aufhalten; die
    // Anmeldeseite legt das Token sonst bei ihrem ersten Aufruf an.
    try {
      const { ensureSetupToken } = await import("@/lib/setup-token");
      ensureSetupToken().catch((e: unknown) => {
        console.error("Einrichtungs-Token beim Start nicht geprueft:", e);
      });
    } catch (e) {
      console.error("Einrichtungs-Token beim Start nicht geprueft:", e);
    }

    // 4. Hintergrundjobs.
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
