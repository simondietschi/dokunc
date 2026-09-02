import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { toMarkdown } from "@/lib/markdown";
import { contentToHtml, pageToPrintHtml } from "@/lib/page-html";
import { htmlToPdf, gotenbergUrl } from "@/lib/pdf";
import { inlineUploadImages } from "@/lib/inline-images";
import { loadUpload } from "@/lib/uploads";
import { extractHeadings } from "@dokunc/editor";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Seiten-Export: ?format=md (Default) | html | pdf
 * PDF nutzt Gotenberg (GOTENBERG_URL); ohne Gotenberg antwortet die
 * Route mit 501 + Hinweis auf die Druckansicht (/p/[id]/print).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Nicht angemeldet", { status: 401 });
  }
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") ?? "md";

  const page = await prisma.page.findFirst({
    where: { id, deletedAt: null },
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

  const safe =
    page.title.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60) || "page";

  if (format === "md") {
    const md = `# ${page.icon ? `${page.icon} ` : ""}${page.title}\n\n${toMarkdown(page.content)}`;
    return new NextResponse(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safe}.md"`,
      },
    });
  }

  // Bilder als data:-URI einbetten — der Export muss ohne laufende App
  // funktionieren (Gotenberg kennt keine Basis-URL, eine gespeicherte
  // .html-Datei wird per file:// geöffnet).
  const html = pageToPrintHtml({
    title: page.title,
    icon: page.icon,
    headings: extractHeadings(page.content),
    spaceName: page.space.name,
    contentHtml: await inlineUploadImages(
      contentToHtml(page.content),
      loadUpload,
    ),
  });

  if (format === "html") {
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safe}.html"`,
      },
    });
  }

  if (format === "pdf") {
    const pdf = await htmlToPdf(html);
    if (!pdf) {
      const hint = gotenbergUrl()
        ? "PDF-Dienst (Gotenberg) nicht erreichbar."
        : "PDF-Dienst nicht konfiguriert (GOTENBERG_URL). Nutze die Druckansicht: /p/" +
          id +
          "/print";
      return new NextResponse(hint, { status: 501 });
    }
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safe}.pdf"`,
      },
    });
  }

  return new NextResponse("Unbekanntes Format", { status: 400 });
}
