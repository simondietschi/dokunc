import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { readablePageRole } from "@/lib/page-access";
import { getCurrentUser } from "@/lib/current-user";
import { nonceFromHeaders } from "@/lib/csp";
import { contentToHtml, pageToPrintHtml } from "@/lib/page-html";

export const runtime = "nodejs";

/**
 * Druckansicht: druckfertiges HTML, das den Druckdialog von selbst
 * oeffnet (Skript mit der Nonce der Anfrage, siehe pageToPrintHtml).
 * Universeller PDF-Weg ohne Zusatzdienst (Browser: "Als PDF speichern").
 */
export async function GET(
  req: Request,
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
      content: true,
      spaceId: true,
      space: { select: { name: true } },
    },
  });
  if (!page) return new NextResponse("Nicht gefunden", { status: 404 });

  if (!(await readablePageRole(user.id, pageId, page.spaceId))) {
    return new NextResponse("Kein Zugriff", { status: 403 });
  }

  const html = pageToPrintHtml({
    title: page.title,
    spaceName: page.space.name,
    contentHtml: contentToHtml(page.content),
    // Die Antwort traegt die CSP der Middleware; eine Export-CSP sperrte die Bilder aus /api/files.
    target: "print",
    // Ohne die Nonce dieser Anfrage blockiert dieselbe CSP das Druckskript.
    printNonce: nonceFromHeaders(req.headers),
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
