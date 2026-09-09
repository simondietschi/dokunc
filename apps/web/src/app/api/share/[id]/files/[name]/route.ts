import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { resolveShare } from "@/lib/share";
import { fileResponseHeaders } from "@/lib/attachments";
import { isSafeFilename, uploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Datei aus einer freigegebenen Seite.
 *
 * Der Freigabelink ersetzt hier die Anmeldung — deshalb wird er bei
 * jeder Datei erneut geprüft. Der Space allein genügt dabei nicht:
 * hängt der Anhang an einer Seite, muss diese Seite selbst von der
 * Freigabe gedeckt sein (die freigegebene oder, bei `includeChildren`,
 * eine ihrer Unterseiten). Sonst wäre ein einziger Freigabelink der
 * Schlüssel zu allen Dateien des ganzen Space.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const full = uploadPath(name);
  if (!isSafeFilename(name) || !full) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const token = new URL(req.url).searchParams.get("token") ?? "";
  const share = await resolveShare(id, token);
  if (!share) return new NextResponse("Not found", { status: 404 });

  const attachment = await prisma.attachment.findFirst({
    where: { storedName: name, spaceId: share.spaceId },
    select: { name: true, mimeType: true, pageId: true },
  });
  if (!attachment) return new NextResponse("Not found", { status: 404 });

  // Anhänge älterer Uploads haben keinen Seitenbezug; für sie bleibt es
  // beim Space der Freigabe.
  if (attachment.pageId && attachment.pageId !== share.page.id) {
    const owner = await resolveShare(id, token, attachment.pageId);
    if (!owner) return new NextResponse("Not found", { status: 404 });
  }

  let size: number;
  try {
    const s = await stat(full);
    if (!s.isFile()) return new NextResponse("Not found", { status: 404 });
    size = s.size;
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const wantInline = new URL(req.url).searchParams.get("inline") === "1";
  const headers = fileResponseHeaders(attachment, size, wantInline);

  const stream = Readable.toWeb(
    createReadStream(full),
  ) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(stream, { headers });
}
