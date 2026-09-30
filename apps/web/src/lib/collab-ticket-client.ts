import { COLLAB_REJECT_REASON } from "@dokunc/editor";

/**
 * Ergebnis eines Ticket-Abrufs: ein Ticket, oder eine endgueltige
 * Auskunft (409), nach der der Editor nicht mehr verbindet:
 *  - restored: die Instanz wurde seit dem Laden des Tabs
 *    zurueckgespielt (Code restore-epoch);
 *  - stale: der Tab laeuft mit einem anderen Editor-Schema als die
 *    Web-App (Code stale-client), er muss neu geladen werden.
 */
export type TicketResult =
  | { kind: "ticket"; ticket: string }
  | { kind: "restored" }
  | { kind: "stale" };

/**
 * POST /api/collab/ticket mit { pageId, epoch, schema } (epoch immer,
 * auch null: daran erkennt die Route einen Editor, der die
 * Restore-Epoche kennt; schema ist der Hash aus editorSchema()).
 * 409 mit code restore-epoch -> restored, mit stale-client -> stale;
 * jede andere Ablehnung wirft. Der Provider behandelt den Fehler als
 * gescheiterte Anmeldung und versucht es spaeter erneut.
 */
export async function requestCollabTicket(
  pageId: string,
  restoreEpoch: string | null,
  schemaHash: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TicketResult> {
  const res = await fetchImpl("/api/collab/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId, epoch: restoreEpoch, schema: schemaHash }),
  });
  if (res.status === 409) {
    const data = (await res.json().catch(() => null)) as { code?: unknown } | null;
    if (data?.code === COLLAB_REJECT_REASON.restoreEpoch) return { kind: "restored" };
    if (data?.code === COLLAB_REJECT_REASON.staleClient) return { kind: "stale" };
  }
  if (!res.ok) throw new Error(`Ticket abgelehnt (${res.status})`);
  const { ticket } = (await res.json()) as { ticket: string };
  return { kind: "ticket", ticket };
}
