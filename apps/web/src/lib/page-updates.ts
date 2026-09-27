import "server-only";
import { prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { publishNotification } from "@/lib/notify-bus";

/**
 * Wer die Seite oeffnet, sieht ihren aktuellen Stand: offene
 * Aenderungsmeldungen dazu sind erledigt, und die naechste Aenderung darf
 * wieder melden. Nur PAGE_UPDATED. Via after(), Fehler nur im Log.
 *
 * Das Publizieren zieht die Glocke in offenen Tabs nach; der Durchlauf,
 * den das ausloest, findet nichts mehr (count 0).
 */
export async function markPageUpdatesRead(
  userId: string,
  pageId: string,
): Promise<void> {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { userId, pageId, type: "PAGE_UPDATED", readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) await publishNotification([userId]);
  } catch (err) {
    log.warn(
      { err, userId, pageId },
      "Aenderungsmeldungen nicht als gelesen markiert",
    );
  }
}
