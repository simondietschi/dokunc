import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { effectiveRole } from "@/lib/space-access";
import { getCurrentUser } from "@/lib/current-user";
import { can } from "@/lib/permissions";
import { isSameOrigin } from "@/lib/origin";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import {
  UPLOAD_DIR,
  MAX_UPLOAD_BYTES,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_IMAGE_TYPES,
  safeDisplayName,
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

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  if (!(await rateLimit(await clientKey("upload"), 30, 60))) {
    return NextResponse.json(
      { error: "Zu viele Uploads. Bitte kurz warten." },
      { status: 429 },
    );
  }

  const form = await req.formData();

  // Jede Datei gehört zu einem Space — das ist die Grundlage dafür,
  // dass /api/files sie nicht an Fremde ausliefert.
  const spaceId = form.get("spaceId");
  if (typeof spaceId !== "string" || !spaceId) {
    return NextResponse.json({ error: "spaceId fehlt" }, { status: 400 });
  }
  const role = await effectiveRole(user.id, spaceId);
  if (!can(role, "write")) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei" }, { status: 400 });
  }

  // "file" = beliebiger Anhang, sonst gilt die strenge Bildprüfung.
  const isAttachment = form.get("kind") === "file";
  const limit = isAttachment ? MAX_ATTACHMENT_BYTES : MAX_UPLOAD_BYTES;
  if (file.size > limit) {
    return NextResponse.json(
      {
        error: `Datei zu groß (max. ${Math.round(limit / 1024 / 1024)} MB)`,
      },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Echten Typ aus den Magic Bytes ableiten — der vom Client gelieferte
  // MIME-Header ist fälschbar und wird nie gespeichert.
  const sniffed = sniffImageType(bytes);
  if (!isAttachment) {
    const ext = sniffed ? ALLOWED_IMAGE_TYPES[sniffed] : undefined;
    if (!ext || !sniffed) {
      return NextResponse.json(
        { error: "Nur echte PNG-, JPG-, GIF- oder WebP-Bilder erlaubt" },
        { status: 415 },
      );
    }
    return store(bytes, ext, sniffed, "IMAGE", file.name, spaceId, user.id);
  }

  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Datei ist leer" }, { status: 400 });
  }

  // Der Typ wird auch beim Anhang vom Server bestimmt: nur was sich
  // eindeutig erkennen lässt, darf später inline ausgeliefert werden.
  const contentType =
    sniffed ?? (isPdf(bytes) ? "application/pdf" : "application/octet-stream");
  return store(
    bytes,
    extensionFor(file.name),
    contentType,
    "FILE",
    file.name,
    spaceId,
    user.id,
  );
}

/** PDF-Signatur: %PDF- */
function isPdf(b: Uint8Array): boolean {
  return (
    b.length > 5 &&
    b[0] === 0x25 &&
    b[1] === 0x50 &&
    b[2] === 0x44 &&
    b[3] === 0x46 &&
    b[4] === 0x2d
  );
}

/**
 * Endung für den Namen auf der Platte. Bewusst eng gefasst: der Name
 * muss `isSafeFilename` genügen, und der Anzeigename steht ohnehin in
 * der Datenbank.
 */
function extensionFor(originalName: string): string {
  const raw = originalName.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : "bin";
}

async function store(
  bytes: Buffer,
  ext: string,
  contentType: string,
  kind: "IMAGE" | "FILE",
  originalName: string,
  spaceId: string,
  userId: string,
) {
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), bytes);

  // Erst nach dem Schreiben registrieren: ein Datensatz ohne Datei
  // wäre ein toter Link, eine Datei ohne Datensatz bleibt unlesbar.
  await prisma.upload.create({
    data: {
      filename: name,
      originalName: safeDisplayName(originalName),
      kind,
      spaceId,
      uploaderId: userId,
      contentType,
      size: bytes.byteLength,
    },
  });
  await audit({
    action: "upload.created",
    actorId: userId,
    spaceId,
    targetId: name,
    metadata: { contentType, size: bytes.byteLength, kind },
  });

  return NextResponse.json({
    url: `/api/files/${name}`,
    name: safeDisplayName(originalName),
    size: bytes.byteLength,
    contentType,
  });
}
