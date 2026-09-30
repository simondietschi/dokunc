import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { titlesForUser } from "@/lib/link-titles";
import { rateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limits";

/** Höchstzahl IDs je Anfrage; der Editor fragt in Stapeln dieser Grösse. */
const MAX_IDS = 100;

/**
 * Aktuelle Titel der Ziele von Wiki-Links, für den Editor:
 * `GET ?ids=a,b,c` → `{ titles: { [id]: string | null } }`.
 *
 * null heisst: die angemeldete Person darf die Seite nicht öffnen, sie
 * liegt im Papierkorb oder es gibt sie nicht. Die drei Fälle sehen
 * gleich aus, sonst verriete die Antwort, dass eine geschützte Seite
 * existiert. Eine ungültige ID bekommt ebenfalls null, statt den ganzen
 * Stapel mit 400 abzulehnen: ein Link aus einem Import oder mit fremder
 * ID nähme sonst allen anderen Links der Seite den Titel.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  if (
    !(await rateLimit(
      `page-titles:${user.id}`,
      RATE_LIMITS.pageTitles.versuche,
      RATE_LIMITS.pageTitles.fenster,
    ))
  ) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte kurz warten." },
      { status: 429 },
    );
  }

  // Erster Wert wie bei den übrigen Routen; ein doppelter Parameter
  // erweitert die Liste nicht.
  const roh = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = [
    ...new Set(
      roh
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const titel = await titlesForUser(user.id, ids);
  return NextResponse.json(
    { titles: Object.fromEntries(ids.map((id) => [id, titel.get(id) ?? null])) },
    // Die Antwort hängt an Person und Schutz; kein Zwischenspeicher darf
    // sie einer anderen Person oder nach einem Entzug ausliefern.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
