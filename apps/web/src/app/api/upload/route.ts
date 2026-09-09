import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin } from "@/lib/origin";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { can } from "@/lib/permissions";
import { effectiveRole } from "@/lib/space-access";
import { canSeePage } from "@/lib/page-access";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import {
  UPLOAD_DIR,
  ALLOWED_IMAGE_TYPES,
  mimeTypeForExtension,
  safeExtension,
  sanitizeFilename,
  sniffImageType,
  uploadLimitBytes,
  uploadLimitMb,
} from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Datei-Upload (Bilder und beliebige Anhaenge).
 * Formularfelder: file, spaceId (Pflicht), pageId (optional),
 * kind (optional: "image" erzwingt die strenge Bildpruefung, "file"
 * speichert auch ein Bild als Anhang; ohne Angabe entscheiden die
 * Magic Bytes).
 * Antwort: { url, name, size, mimeType, kind: "image" | "file" }.
 *
 * Bilder werden an den Magic Bytes erkannt und inline eingebettet; alles
 * andere wird als Anhang gespeichert und spaeter nur als Download
 * ausgeliefert (siehe /api/files). Der Datensatz bindet die Datei an den
 * Space und — wenn mitgeschickt — an die Seite: beides zusammen
 * entscheidet spaeter, wer sie abrufen darf.
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

  // Vor dem Puffern pruefen: `req.formData()` liest den KOMPLETTEN Body
  // in den Speicher, bevor irgendein Limit greift — eine 5-GB-Anfrage
  // haette den Prozess sonst schon erledigt, ehe die Groessenpruefung
  // weiter unten ueberhaupt drankommt.
  const maxBody = uploadLimitBytes("FILE");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBody + 64 * 1024) {
    return NextResponse.json(
      { error: `Datei zu gross (max. ${uploadLimitMb("FILE")} MB)` },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // Kaputter Multipart-Body: als 400 beantworten statt als 500 aus
    // einer nicht behandelten Ablehnung.
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Keine Datei" }, { status: 400 });
  }

  // Jede Datei gehört zu einem Space — das ist die Grundlage dafür,
  // dass /api/files sie nicht an Fremde ausliefert.
  const spaceIdRaw = form.get("spaceId");
  const spaceId = typeof spaceIdRaw === "string" ? spaceIdRaw.trim() : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId fehlt" }, { status: 400 });
  }

  // Wirksame Rolle statt blosser Mitgliedschaft: wer nur ueber eine
  // Gruppe Schreibrecht hat, koennte sonst nichts hochladen.
  const role = await effectiveRole(user.id, spaceId);
  if (!can(role, "write")) {
    return NextResponse.json(
      { error: "Kein Schreibzugriff auf diesen Space" },
      { status: 403 },
    );
  }

  // Die Seite (falls angegeben) muss zum selben Space gehoeren und fuer
  // die hochladende Person sichtbar sein — sonst liesse sich ein Anhang
  // in eine geschuetzte Seite haengen, die sie gar nicht sieht.
  const pageIdRaw = form.get("pageId");
  const pageId = typeof pageIdRaw === "string" ? pageIdRaw.trim() : "";
  let attachedPageId: string | null = null;
  if (pageId) {
    const page = await prisma.page.findFirst({
      where: { id: pageId, spaceId, deletedAt: null },
      select: { id: true },
    });
    if (!page || !(await canSeePage(page.id, user.id, role))) {
      return NextResponse.json(
        { error: "Seite nicht gefunden" },
        { status: 400 },
      );
    }
    attachedPageId = page.id;
  }

  // "file" = ausdruecklich ein Anhang, "image" = ausdruecklich ein Bild;
  // ohne Angabe entscheidet der Inhalt.
  const kindField = form.get("kind");
  const wantedKind =
    kindField === "file" ? "FILE" : kindField === "image" ? "IMAGE" : null;

  // Grobpruefung vor dem Puffern; die genaue Grenze haengt an der Art
  // der Datei und wird nach dem Erkennen noch einmal geprueft.
  if (file.size > uploadLimitBytes(wantedKind ?? "FILE")) {
    return NextResponse.json(
      {
        error: `Datei zu gross (max. ${uploadLimitMb(wantedKind ?? "FILE")} MB)`,
      },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Datei ist leer" }, { status: 400 });
  }

  // Echten Bildtyp aus den Magic Bytes ableiten — der vom Client
  // gelieferte MIME-Header ist faelschbar und wird nie gespeichert.
  const sniffed = sniffImageType(bytes);
  if (wantedKind === "IMAGE" && !sniffed) {
    return NextResponse.json(
      { error: "Nur echte PNG-, JPG-, GIF- oder WebP-Bilder erlaubt" },
      { status: 415 },
    );
  }
  const kind: "IMAGE" | "FILE" =
    wantedKind === "FILE" ? "FILE" : sniffed ? "IMAGE" : "FILE";

  if (bytes.length > uploadLimitBytes(kind)) {
    return NextResponse.json(
      { error: `Datei zu gross (max. ${uploadLimitMb(kind)} MB)` },
      { status: 413 },
    );
  }

  const imageType = kind === "IMAGE" ? sniffed : null;
  const ext = imageType
    ? ALLOWED_IMAGE_TYPES[imageType]
    : safeExtension(file.name);
  const mimeType = imageType ?? mimeTypeForExtension(ext);
  const name = sanitizeFilename(file.name);
  const storedName = `${randomBytes(16).toString("hex")}.${ext}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  const fullPath = path.join(UPLOAD_DIR, storedName);
  await writeFile(fullPath, bytes);

  try {
    // Erst nach dem Schreiben registrieren: ein Datensatz ohne Datei
    // waere ein toter Link, eine Datei ohne Datensatz bleibt unlesbar.
    const attachment = await prisma.attachment.create({
      data: {
        spaceId,
        pageId: attachedPageId,
        uploaderId: user.id,
        storedName,
        name,
        mimeType,
        kind,
        size: bytes.length,
      },
      select: { name: true, size: true, mimeType: true },
    });
    await audit({
      action: "upload.created",
      actorId: user.id,
      spaceId,
      targetId: storedName,
      metadata: {
        mimeType,
        size: bytes.length,
        kind,
        pageId: attachedPageId,
      },
    });
    return NextResponse.json({
      url: `/api/files/${storedName}`,
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType,
      kind: kind === "IMAGE" ? "image" : "file",
    });
  } catch (e) {
    // Ohne Datensatz keine verwaiste Datei zuruecklassen.
    await unlink(fullPath).catch(() => {});
    log.error(
      { err: String(e), spaceId },
      "Attachment konnte nicht gespeichert werden",
    );
    return NextResponse.json(
      { error: "Upload fehlgeschlagen" },
      { status: 500 },
    );
  }
}
