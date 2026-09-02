/**
 * Läuft einmal beim Start des Next-Servers (nicht beim Build):
 * startet den Zeitplan für die tägliche Mail-Zusammenfassung.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startDigestScheduler } = await import("@/lib/digest");
  startDigestScheduler();
}
