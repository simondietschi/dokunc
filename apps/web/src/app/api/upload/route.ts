import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { isSameOrigin } from "@/lib/origin";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import {
  UPLOAD_DIR,
  MAX_UPLOAD_BYTES,
  ALLOWED_IMAGE_TYPES,
  sniffImageType,
} from "@/lib/uploads";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (
    !isSameOrigin(
      req.headers.get("origin"),
      process.env.APP_URL,
      req.headers.get("host"),
    )
  ) {
    return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });
  }

  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  if (!(await rateLimit(await clientKey("upload"), 30, 60))) {
    return NextResponse.json(
      { error: "Zu viele Uploads. Bitte kurz warten." },
      { status: 429 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Datei zu groß (max. 10 MB)" },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Echten Typ aus den Magic Bytes ableiten — der vom Client gelieferte
  // MIME-Header ist fälschbar und wird ignoriert.
  const sniffed = sniffImageType(bytes);
  const ext = sniffed ? ALLOWED_IMAGE_TYPES[sniffed] : undefined;
  if (!ext) {
    return NextResponse.json(
      { error: "Nur echte PNG-, JPG-, GIF- oder WebP-Bilder erlaubt" },
      { status: 415 },
    );
  }

  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), bytes);

  return NextResponse.json({ url: `/api/files/${name}` });
}
