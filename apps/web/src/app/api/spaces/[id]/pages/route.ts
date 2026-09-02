import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";

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
 * Auswahl-Dialoge wie "Verschieben nach...". Nur fuer Space-Mitglieder.
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

  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId } },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  const pages = await prisma.page.findMany({
    where: { spaceId, deletedAt: null, isTemplate: false },
    select: { id: true, title: true, parentId: true, position: true },
    orderBy: [{ position: "asc" }, { title: "asc" }],
  });
  const body: SpacePagesResponse = { pages };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
