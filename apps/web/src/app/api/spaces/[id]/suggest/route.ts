import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { effectiveRole } from "@/lib/space-access";
import { visiblePageWhere } from "@/lib/page-access";
import { getCurrentUser } from "@/lib/current-user";
import { likeEscape } from "@/lib/palette";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Vorschläge für Editor-Popups:
 *   ?kind=pages   -> Seiten des Space ([[Wiki-Link]])
 *   ?kind=members -> Mitglieder des Space (@-Mention)
 * Nur für Space-Mitglieder.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  const { id: spaceId } = await params;

  const role = await effectiveRole(user.id, spaceId);
  if (!role) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  // Der Editor fragt bei JEDEM Tastendruck, ohne Entprellung — das
  // Fenster liegt deshalb weit ueber dem, was Tippen erzeugt. Ohne
  // Bremse laesst sich die Abfrage (zwei `contains` mit fuehrendem
  // Platzhalter, also ohne Index) beliebig oft wiederholen; alle
  // anderen teuren Endpunkte haben eine.
  if (!(await rateLimit(`suggest:${user.id}`, 240, 60))) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte kurz warten." },
      { status: 429 },
    );
  }

  const url = new URL(req.url);
  // Positivliste statt "alles ausser members sind Seiten": ein Tippfehler
  // wie ?kind=member lieferte sonst mit 200 Seitentitel zurueck, und der
  // Aufrufer merkte nie, dass sein Parameter nicht verstanden wurde.
  const kind = url.searchParams.get("kind") ?? "pages";
  if (kind !== "pages" && kind !== "members") {
    return NextResponse.json({ error: "Unbekannte Art" }, { status: 400 });
  }
  // Wie in der Schwesterroute api/search auf 100 Zeichen geschnitten:
  // ungekuerzt wird aus jedem Query-String, den der Proxy durchlaesst,
  // ein ILIKE-Muster dieser Laenge ueber alle Seiten des Space.
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);

  if (kind === "members") {
    // Zugang direkt oder über eine Gruppe. Der Collab-Server behandelt
    // Gruppenmitglieder als erwähnbar; tauchten sie hier nicht auf,
    // widersprächen sich die beiden Hälften.
    const people = await prisma.user.findMany({
      where: {
        isActive: true,
        // Wie in api/search maskiert: `contains` reicht % und _
        // ungeschuetzt ins LIKE-Muster, eine Suche nach "%" traefe sonst
        // jede Person des Space.
        ...(q
          ? { name: { contains: likeEscape(q), mode: "insensitive" } }
          : {}),
        OR: [
          { memberships: { some: { spaceId } } },
          {
            groupMemberships: {
              some: { group: { spaces: { some: { spaceId } } } },
            },
          },
        ],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 8,
    });
    return NextResponse.json({
      items: people.map((p) => ({ id: p.id, label: p.name })),
    });
  }

  const pages = await prisma.page.findMany({
    where: {
      spaceId,
      deletedAt: null,
      // Ein Vorschlag ist schon eine Auskunft: geschützte Seiten
      // dürfen hier nicht einmal mit dem Titel auftauchen.
      ...visiblePageWhere(user.id, role),
      // Vorlagen sind keine Link-Ziele.
      isTemplate: false,
      // Siehe oben: dieselbe Maskierung wie bei den Mitgliedern.
      ...(q
        ? { title: { contains: likeEscape(q), mode: "insensitive" } }
        : {}),
    },
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  return NextResponse.json({
    items: pages.map((p) => ({ id: p.id, label: p.title || "Untitled" })),
  });
}
