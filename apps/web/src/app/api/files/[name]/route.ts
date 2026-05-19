import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  UPLOAD_DIR,
  isSafeFilename,
  contentTypeForFile,
} from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isSafeFilename(name)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const base = path.resolve(UPLOAD_DIR);
  const full = path.resolve(base, name);
  // Defense in depth: aufgelöster Pfad muss im Upload-Verzeichnis liegen.
  if (full !== path.join(base, name) || !full.startsWith(base + path.sep)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  try {
    const data = await readFile(full);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeForFile(name),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
