import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { effectiveRole } from "@/lib/space-access";
import { visiblePageWhere } from "@/lib/page-access";

export const runtime = "nodejs";

export type SpacePagesResponse = {
  pages: {
    id: string;
    title: string;
    parentId: string | null;
    position: number;
  }[];
};

/**
 * Flacher Seitenbaum eines Space (ohne Vorlagen, ohne Papierkorb) fuer
 * Auswahl-Dialoge wie "Verschieben nach...".
 *
 * Zugang zaehlt hier wie ueberall: eigene Mitgliedschaft ODER eine
 * Gruppe. Und die Liste haelt sich an dieselbe Sichtbarkeit wie der
 * Seitenbaum — sonst stuenden die Titel geschuetzter Seiten in einer
 * Antwort, die jedes Mitglied abrufen kann.
 */
export async function GET(
  _req: Request,
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

  const pages = await prisma.page.findMany({
    where: {
      spaceId,
      deletedAt: null,
      isTemplate: false,
      ...visiblePageWhere(user.id, role),
    },
    select: { id: true, title: true, parentId: true, position: true },
    orderBy: [{ position: "asc" }, { title: "asc" }],
  });
  const body: SpacePagesResponse = { pages };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
