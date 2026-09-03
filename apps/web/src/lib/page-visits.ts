import "server-only";
import { prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { visitsToDrop, shouldCheckVisitLimit } from "@/lib/page-visits-policy";

/**
 * Merkt sich den Besuch einer Seite ("Zuletzt besucht"). Wird via
 * `after()` nach dem Rendern aufgerufen: Fehler werden nur geloggt,
 * der Seitenaufbau darf daran nie scheitern.
 *
 * Aufraeumen: Pro Person bleiben hoechstens VISIT_KEEP Eintraege.
 * Die Pruefung laeuft nur gelegentlich (Zufall), damit nicht jeder
 * Seitenaufruf eine zusaetzliche Count-Query bezahlt.
 */
export async function recordPageVisit(userId: string, pageId: string) {
  try {
    await prisma.pageVisit.upsert({
      where: { userId_pageId: { userId, pageId } },
      create: { userId, pageId },
      update: { visitedAt: new Date() },
    });

    if (!shouldCheckVisitLimit(Math.random())) return;

    const count = await prisma.pageVisit.count({ where: { userId } });
    const drop = visitsToDrop(count);
    if (drop === 0) return;

    // Die aeltesten Eintraege ueber dem Limit entfernen (per Unique-Index
    // sind userId+pageId eindeutig, die Sortierung nach visitedAt ist stabil
    // genug: bei Gleichstand entscheidet die id).
    const stale = await prisma.pageVisit.findMany({
      where: { userId },
      orderBy: [{ visitedAt: "asc" }, { id: "asc" }],
      take: drop,
      select: { id: true },
    });
    await prisma.pageVisit.deleteMany({
      where: { userId, id: { in: stale.map((v) => v.id) } },
    });
  } catch (err) {
    log.warn(
      { err, userId, pageId },
      "Seitenbesuch konnte nicht gespeichert werden",
    );
  }
}
