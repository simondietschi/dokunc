import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { contentToHtml, pageToPrintHtml } from "@/lib/page-html";
import { extractHeadings } from "@dokunc/editor";

export const runtime = "nodejs";

/**
 * Druckansicht: druckfertiges HTML mit automatischem window.print().
 * Universeller PDF-Weg ohne Zusatzdienst (Browser: "Als PDF speichern").
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/login", process.env.APP_URL ?? "http://localhost:3000"),
    );
  }
  const { pageId } = await params;

  const page = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: {
      title: true,
      icon: true,
      content: true,
      spaceId: true,
      space: { select: { name: true } },
    },
  });
  if (!page) return new NextResponse("Nicht gefunden", { status: 404 });

  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId: page.spaceId } },
    select: { id: true },
  });
  if (!member) return new NextResponse("Kein Zugriff", { status: 403 });

  const html = pageToPrintHtml({
    title: page.title,
    icon: page.icon,
    headings: extractHeadings(page.content),
    spaceName: page.space.name,
    contentHtml: contentToHtml(page.content),
  }).replace(
    "</body>",
    `<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));</script></body>`,
  );

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
