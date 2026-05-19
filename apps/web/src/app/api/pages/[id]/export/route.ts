import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { toMarkdown } from "@/lib/markdown";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Nicht angemeldet", { status: 401 });
  }
  const { id } = await params;

  const page = await prisma.page.findFirst({
    where: { id, deletedAt: null },
    select: { title: true, content: true, spaceId: true },
  });
  if (!page) return new NextResponse("Nicht gefunden", { status: 404 });

  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId: page.spaceId } },
    select: { id: true },
  });
  if (!member) return new NextResponse("Kein Zugriff", { status: 403 });

  const md = `# ${page.title}\n\n${toMarkdown(page.content)}`;
  const safe = page.title.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60);
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe || "page"}.md"`,
    },
  });
}
