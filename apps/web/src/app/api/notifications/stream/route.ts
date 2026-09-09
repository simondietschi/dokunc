import { getCurrentUser } from "@/lib/current-user";
import { subscribeNotifications } from "@/lib/notify-bus";

export const runtime = "nodejs";
// Ein Datenstrom darf nicht zwischengespeichert werden.
export const dynamic = "force-dynamic";

/** Abstand der Lebenszeichen. Hält Proxys davon ab, die Leitung zu kappen. */
const KEEPALIVE_MS = 25_000;

/**
 * Server-Sent Events für die Glocke.
 *
 * Bewusst SSE und nicht WebSocket: es fliesst nur in eine Richtung, und
 * der Collab-WebSocket hat eine ganz andere Aufgabe.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Nicht angemeldet", { status: 401 });

  const encoder = new TextEncoder();
  let subscription: { close: () => void } | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* Verbindung ist bereits zu */
        }
      };

      send(": verbunden\n\n");
      keepalive = setInterval(() => send(": ping\n\n"), KEEPALIVE_MS);
      subscription = subscribeNotifications(user.id, () =>
        send("event: notification\ndata: 1\n\n"),
      );

      req.signal.addEventListener("abort", () => {
        if (keepalive) clearInterval(keepalive);
        subscription?.close();
        try {
          controller.close();
        } catch {
          /* schon geschlossen */
        }
      });
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      subscription?.close();
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
