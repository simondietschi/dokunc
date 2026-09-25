import { COLLAB_REJECT_REASON } from "@dokunc/editor";

/**
 * Ergebnis eines Ticket-Abrufs: ein Ticket, oder die Auskunft, dass die
 * Instanz seit dem Laden des Tabs zurueckgespielt wurde (409 mit Code
 * restore-epoch). Der zweite Fall ist endgueltig, der Editor verbindet
 * danach nicht mehr.
 */
export type TicketResult = { kind: "ticket"; ticket: string } | { kind: "restored" };

/**
 * POST /api/collab/ticket mit { pageId, epoch } (epoch immer, auch null:
 * daran erkennt die Route einen Editor, der die Restore-Epoche kennt).
 * 409 mit code restore-epoch -> restored; jede andere Ablehnung wirft.
 * Der Provider behandelt den Fehler als gescheiterte Anmeldung und
 * versucht es spaeter erneut.
 */
export async function requestCollabTicket(
  pageId: string,
  restoreEpoch: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TicketResult> {
  const res = await fetchImpl("/api/collab/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId, epoch: restoreEpoch }),
  });
  if (res.status === 409) {
    const data = (await res.json().catch(() => null)) as { code?: unknown } | null;
    if (data?.code === COLLAB_REJECT_REASON.restoreEpoch) return { kind: "restored" };
  }
  if (!res.ok) throw new Error(`Ticket abgelehnt (${res.status})`);
  const { ticket } = (await res.json()) as { ticket: string };
  return { kind: "ticket", ticket };
}
