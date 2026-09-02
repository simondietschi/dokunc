import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin } from "@/lib/origin";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { can } from "@/lib/permissions";
import { log } from "@/lib/log";
import {
  UPLOAD_DIR,
  ALLOWED_IMAGE_TYPES,
  maxUploadBytes,
  maxUploadMb,
  mimeTypeForExtension,
  safeExtension,
  sanitizeFilename,
  sniffImageType,
} from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Datei-Upload (Bilder und beliebige Anhaenge).
 * Formularfelder: file, spaceId (Pflicht), pageId (optional).
 * Antwort: { url, name, size, mimeType, kind: "image" | "file" }.
 *
 * Bilder werden an den Magic Bytes erkannt und inline eingebettet; alles
 * andere wird als Anhang gespeichert und spaeter nur als Download
 * ausgeliefert (siehe /api/files). Der Datensatz bindet die Datei an den
 * Space — nur dessen Mitglieder duerfen sie abrufen.
 */
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
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei" }, { status: 400 });
  }

  const spaceIdRaw = form.get("spaceId");
  const spaceId = typeof spaceIdRaw === "string" ? spaceIdRaw.trim() : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId fehlt" }, { status: 400 });
  }
  const pageIdRaw = form.get("pageId");
  const pageId = typeof pageIdRaw === "string" ? pageIdRaw.trim() : "";

  // Mitgliedschaft mit Schreibrecht im Ziel-Space (kein Cross-Space-Upload).
  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId } },
    select: { role: true },
  });
  if (!member || !can(member.role, "write")) {
    return NextResponse.json(
      { error: "Kein Schreibzugriff auf diesen Space" },
      { status: 403 },
    );
  }

  // Die Seite (falls angegeben) muss zum selben Space gehoeren.
  let attachedPageId: string | null = null;
  if (pageId) {
    const page = await prisma.page.findFirst({
      where: { id: pageId, spaceId, deletedAt: null },
      select: { id: true },
    });
    if (!page) {
      return NextResponse.json(
        { error: "Seite nicht gefunden" },
        { status: 400 },
      );
    }
    attachedPageId = page.id;
  }

  if (file.size > maxUploadBytes()) {
    return NextResponse.json(
      { error: `Datei zu gross (max. ${maxUploadMb()} MB)` },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Leere Datei" }, { status: 400 });
  }

  // Echten Bildtyp aus den Magic Bytes ableiten — der vom Client
  // gelieferte MIME-Header ist faelschbar und wird ignoriert. Kein Bild
  // -> gewoehnlicher Anhang mit konservativem Typ nach Endung.
  const sniffed = sniffImageType(bytes);
  const kind: "image" | "file" = sniffed ? "image" : "file";
  const ext = sniffed ? ALLOWED_IMAGE_TYPES[sniffed] : safeExtension(file.name);
  const mimeType = sniffed ?? mimeTypeForExtension(ext);
  const name = sanitizeFilename(file.name);
  const storedName = `${randomBytes(16).toString("hex")}.${ext}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  const fullPath = path.join(UPLOAD_DIR, storedName);
  await writeFile(fullPath, bytes);

  try {
    const attachment = await prisma.attachment.create({
      data: {
        spaceId,
        pageId: attachedPageId,
        uploaderId: user.id,
        storedName,
        name,
        mimeType,
        size: bytes.length,
      },
      select: { name: true, size: true, mimeType: true },
    });
    return NextResponse.json({
      url: `/api/files/${storedName}`,
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType,
      kind,
    });
  } catch (e) {
    // Ohne Datensatz keine verwaiste Datei zuruecklassen.
    await unlink(fullPath).catch(() => {});
    log.error({ err: String(e), spaceId }, "Attachment konnte nicht gespeichert werden");
    return NextResponse.json(
      { error: "Upload fehlgeschlagen" },
      { status: 500 },
    );
  }
}
