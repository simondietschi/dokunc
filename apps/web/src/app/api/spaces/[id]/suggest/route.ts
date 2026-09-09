import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { effectiveRole } from "@/lib/space-access";
import { visiblePageWhere } from "@/lib/page-access";
import { getCurrentUser } from "@/lib/current-user";

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

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "pages";
  const q = (url.searchParams.get("q") ?? "").trim();

  if (kind === "members") {
    // Zugang direkt oder über eine Gruppe. Der Collab-Server behandelt
    // Gruppenmitglieder als erwähnbar; tauchten sie hier nicht auf,
    // widersprächen sich die beiden Hälften.
    const people = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
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
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    },
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  return NextResponse.json({
    items: pages.map((p) => ({ id: p.id, label: p.title || "Untitled" })),
  });
}
