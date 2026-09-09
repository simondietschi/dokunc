import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { resolveShare } from "@/lib/share";
import {
  UPLOAD_DIR,
  contentDisposition,
  isInlineType,
  isSafeFilename,
} from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Datei aus einer freigegebenen Seite.
 *
 * Der Freigabelink ersetzt hier die Anmeldung — deshalb wird er bei
 * jeder Datei erneut geprüft, und die Datei muss zum selben Space
 * gehören wie die freigegebene Seite.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  if (!isSafeFilename(name)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const token = new URL(req.url).searchParams.get("token") ?? "";
  const share = await resolveShare(id, token);
  if (!share) return new NextResponse("Not found", { status: 404 });

  const upload = await prisma.upload.findFirst({
    where: { filename: name, spaceId: share.spaceId },
    select: { originalName: true, contentType: true },
  });
  if (!upload) return new NextResponse("Not found", { status: 404 });

  const base = path.resolve(UPLOAD_DIR);
  const full = path.resolve(base, name);
  if (full !== path.join(base, name) || !full.startsWith(base + path.sep)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const inline = isInlineType(upload.contentType);
  try {
    const data = await readFile(full);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": inline
          ? upload.contentType
          : "application/octet-stream",
        "Content-Disposition": contentDisposition(
          upload.originalName || name,
          inline,
        ),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
