import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
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

  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId } },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "pages";
  const q = (url.searchParams.get("q") ?? "").trim();

  if (kind === "members") {
    const members = await prisma.spaceMember.findMany({
      where: {
        spaceId,
        user: q
          ? { name: { contains: q, mode: "insensitive" }, isActive: true }
          : { isActive: true },
      },
      select: { user: { select: { id: true, name: true } } },
      take: 8,
    });
    return NextResponse.json({
      items: members.map((m) => ({ id: m.user.id, label: m.user.name })),
    });
  }

  const pages = await prisma.page.findMany({
    where: {
      spaceId,
      deletedAt: null,
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
