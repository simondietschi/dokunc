import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { isSafeFilename, uploadPath } from "@/lib/uploads";
import { findReadableAttachment } from "@/lib/file-access";
import { fileResponseHeaders } from "@/lib/attachments";

export const runtime = "nodejs";

/**
 * Auslieferung hochgeladener Dateien — nur fuer angemeldete Mitglieder
 * des Space, zu dem der Anhang gehoert. Bilder inline, PDF auf Wunsch
 * (?inline=1) in einer CSP-Sandbox, alles andere als Download.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Nicht angemeldet", { status: 401 });
  }

  const { name } = await params;
  const full = uploadPath(name);
  if (!isSafeFilename(name) || !full) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const attachment = await findReadableAttachment(name, user.id);
  if (!attachment) {
    return new NextResponse("Not found", { status: 404 });
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
