import { getCurrentUser } from "@/lib/current-user";
import { subscribeNotifications } from "@/lib/notify-bus";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Ein Datenstrom darf nicht zwischengespeichert werden.
export const dynamic = "force-dynamic";

/** Abstand der Lebenszeichen. Hält Proxys davon ab, die Leitung zu kappen. */
const KEEPALIVE_MS = 25_000;

/**
 * Deckel für gleichzeitig offene Ströme je Person und Web-Prozess.
 *
 * Jeder Strom hält über `subscribeNotifications` eine eigene, dauerhafte
 * Redis-Verbindung samt Dateideskriptor offen. Ohne Deckel belegt eine
 * einzige angemeldete Person mit wiederholten GET-Aufrufen beliebig
 * viele davon; ist das Verbindungslimit von Redis erreicht, fällt mit
 * der Glocke auch die Ratenbegrenzung (still auf den Prozessspeicher)
 * und die Collab-Koordination aus. Mehrere Tabs und ein kurzer
 * Überlappungsmoment beim Neuladen bleiben erlaubt.
 */
const MAX_STREAMS_PER_USER = 6;
const offeneStroeme = new Map<string, number>();

/**
 * Server-Sent Events für die Glocke.
 *
 * Bewusst SSE und nicht WebSocket: es fliesst nur in eine Richtung, und
 * der Collab-WebSocket hat eine ganz andere Aufgabe.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Nicht angemeldet", { status: 401 });

  // Bremse zusätzlich zum Deckel: ohne sie liesse sich dieser durch
  // schnelles Auf- und Zumachen umgehen, denn jeder Versuch baut eine
  // Redis-Verbindung auf, bevor er wieder abgeräumt wird.
  if (!(await rateLimit(`notify-stream:${user.id}`, 30, 60))) {
    return new Response("Zu viele Verbindungen", { status: 429 });
  }

  const offen = offeneStroeme.get(user.id) ?? 0;
  if (offen >= MAX_STREAMS_PER_USER) {
    return new Response("Zu viele offene Verbindungen", { status: 429 });
  }
  offeneStroeme.set(user.id, offen + 1);

  const encoder = new TextEncoder();
  let subscription: { close: () => void } | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  // Beide Aufräumpfade (abort und cancel) können nacheinander kommen;
  // der Zähler darf trotzdem nur einmal je Strom sinken, sonst gäbe der
  // Deckel mit der Zeit mehr Plätze frei, als es je Ströme gab.
  let abgeraeumt = false;
  const release = () => {
    if (abgeraeumt) return;
    abgeraeumt = true;
    if (keepalive) clearInterval(keepalive);
    subscription?.close();
    const rest = (offeneStroeme.get(user.id) ?? 1) - 1;
    if (rest > 0) offeneStroeme.set(user.id, rest);
    else offeneStroeme.delete(user.id);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* Verbindung ist bereits zu */
        }
      };

      const stop = () => {
        release();
        try {
          controller.close();
        } catch {
          /* schon geschlossen */
        }
      };

      send(": verbunden\n\n");
      keepalive = setInterval(() => send(": ping\n\n"), KEEPALIVE_MS);
      subscription = subscribeNotifications(user.id, () =>
        send("event: notification\ndata: 1\n\n"),
      );

      req.signal.addEventListener("abort", stop);
      // Brach die Anfrage schon vor dieser Zeile ab, feuert der eben
      // angehängte Listener nicht mehr: Intervall und Redis-Verbindung
      // liefen dann bis zum Prozessende weiter, eine je Anfrage.
      if (req.signal.aborted) stop();
    },
    cancel() {
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Nginx und Caddy sollen nichts puffern.
      "X-Accel-Buffering": "no",
    },
  });
}
