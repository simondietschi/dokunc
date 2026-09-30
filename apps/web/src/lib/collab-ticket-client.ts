import { COLLAB_REJECT_REASON } from "@dokunc/editor";

/**
 * Codes, mit denen die Ticket-Route endgueltig ablehnt (Feld `code`, je
 * mit festem Status). Clientsicher; die Route importiert sie von hier.
 * - no-session (401): keine gueltige Sitzung mehr;
 * - no-access (403): keine Rolle im Space oder die Seite ist geschuetzt;
 * - not-found (404): die Seite gibt es nicht (mehr), auch im Papierkorb.
 */
export const COLLAB_TICKET_DENIAL = {
  noSession: "no-session",
  noAccess: "no-access",
  notFound: "not-found",
} as const;

export type CollabTicketDenial =
  (typeof COLLAB_TICKET_DENIAL)[keyof typeof COLLAB_TICKET_DENIAL];

/** Welcher Status zu welchem Code gehoert; nur diese Paare zaehlen. */
const STATUS_DER_ABLEHNUNG: Record<CollabTicketDenial, number> = {
  [COLLAB_TICKET_DENIAL.noSession]: 401,
  [COLLAB_TICKET_DENIAL.noAccess]: 403,
  [COLLAB_TICKET_DENIAL.notFound]: 404,
};

function istAblehnung(code: unknown, status: number): code is CollabTicketDenial {
  return (
    typeof code === "string" &&
    Object.hasOwn(STATUS_DER_ABLEHNUNG, code) &&
    STATUS_DER_ABLEHNUNG[code as CollabTicketDenial] === status
  );
}

/**
 * Ergebnis eines Ticket-Abrufs: ein Ticket, oder eine endgueltige
 * Auskunft, nach der der Editor anders weitermacht:
 *  - ticket: mit dem Konto, fuer das die Route es ausgestellt hat (null,
 *    wenn die Antwort keines nennt);
 *  - restored: die Instanz wurde seit dem Laden des Tabs
 *    zurueckgespielt (409 restore-epoch);
 *  - stale: der Tab laeuft mit einem anderen Editor-Schema als die
 *    Web-App (409 stale-client), er muss neu geladen werden;
 *  - denied: die Route lehnt endgueltig ab (Sitzung vorbei, kein Zugriff,
 *    Seite weg); der Editor verwirft dann die lokale Kopie.
 */
export type TicketResult =
  | { kind: "ticket"; ticket: string; userId: string | null }
  | { kind: "restored" }
  | { kind: "stale" }
  | { kind: "denied"; grund: CollabTicketDenial };

/**
 * POST /api/collab/ticket mit { pageId, epoch, schema } (epoch immer,
 * auch null: daran erkennt die Route einen Editor, der die
 * Restore-Epoche kennt; schema ist der Hash aus editorSchema()).
 * 409 mit code restore-epoch -> restored, mit stale-client -> stale;
 * 401, 403 oder 404 mit dem passenden Code -> denied. Jede andere
 * Antwort wirft, auch die 403 "Ungueltige Herkunft" ohne Code, eine
 * Grenze (429), ein Serverfehler und ein Netzfehler: der Provider
 * behandelt das als gescheiterte Anmeldung und versucht es spaeter
 * erneut, und die lokale Kopie bleibt.
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
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const data = (await res.json().catch(() => null)) as { code?: unknown } | null;
    const code = data?.code;
    if (istAblehnung(code, res.status)) return { kind: "denied", grund: code };
  }
  if (!res.ok) throw new Error(`Ticket abgelehnt (${res.status})`);
  const { ticket, userId } = (await res.json()) as { ticket: string; userId?: unknown };
  return { kind: "ticket", ticket, userId: typeof userId === "string" ? userId : null };
}
