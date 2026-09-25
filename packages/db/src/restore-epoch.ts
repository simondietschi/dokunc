import type { PrismaClient } from "./generated/prisma/client";

/** Die eine Zeile von InstanceState. */
export const INSTANCE_STATE_ID = 1;

/**
 * Aktuelle Restore-Epoche, null wenn nie zurueckgespielt oder die Zeile
 * fehlt. Den Client als Parameter, damit Web, Collab und Tests
 * (Transaktions-Client) dieselbe Funktion nutzen.
 *
 * Die Epoche vergibt scripts/restore.sh nach dem Einspielen einer
 * Sicherung neu; das Format (32 Hex-Zeichen) erzwingt die Datenbank
 * (Migration 20260925130000_restore_epoch).
 */
export async function currentRestoreEpoch(
  client: Pick<PrismaClient, "instanceState">,
): Promise<string | null> {
  const row = await client.instanceState.findUnique({
    where: { id: INSTANCE_STATE_ID },
    select: { restoreEpoch: true },
  });
  return row?.restoreEpoch ?? null;
}
