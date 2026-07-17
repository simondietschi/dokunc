import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin } from "@/lib/origin";
import { rateLimit } from "@/lib/rate-limit";
import { aiAvailable, assist, isAssistAction } from "@/lib/ai";
import { log } from "@/lib/log";

export const runtime = "nodejs";
// KI-Antworten können dauern — großzügiges Zeitfenster.
export const maxDuration = 120;

export async function POST(req: Request) {
  if (
    !isSameOrigin(
      req.headers.get("origin"),
      process.env.APP_URL,
      req.headers.get("host"),
    )
  ) {
    return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  if (!aiAvailable()) {
    return NextResponse.json(
      { error: "KI nicht konfiguriert (ANTHROPIC_API_KEY setzen)." },
      { status: 503 },
    );
  }

  if (!(await rateLimit(`assist:${user.id}`, 30, 3600))) {
    return NextResponse.json(
      { error: "Zu viele KI-Anfragen. Bitte später erneut." },
      { status: 429 },
    );
  }

  let body: { action?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!isAssistAction(body.action) || !text) {
    return NextResponse.json(
      { error: "action und text sind erforderlich" },
      { status: 400 },
    );
  }
  if (text.length > 20_000) {
    return NextResponse.json(
      { error: "Text zu lang (max. 20.000 Zeichen)" },
      { status: 413 },
    );
  }

  try {
    const result = await assist(body.action, text);
    return NextResponse.json({ result });
  } catch (e) {
    log.error({ err: String(e) }, "assist fehlgeschlagen");
    return NextResponse.json(
      { error: "KI-Anfrage fehlgeschlagen" },
      { status: 502 },
    );
  }
}
