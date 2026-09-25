import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin, originRejectionHint } from "@/lib/origin";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { can } from "@/lib/permissions";
import { effectiveRole } from "@/lib/space-access";
import { canSeePage } from "@/lib/page-access";
import { audit } from "@/lib/audit";
import { declaredBodySize } from "@/lib/body-size";
import { log } from "@/lib/log";
import { stripImageMetadata } from "@/lib/image-metadata";
import { RATE_LIMITS } from "@/lib/rate-limits";
import { IMAGE_TYPE_NAMES } from "@/lib/image-types";
import {
  UPLOAD_DIR,
  ALLOWED_IMAGE_TYPES,
  isInlineImageType,
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
    // Der eine Fall, der sonst raetselhaft bleibt, gehoert ins Log:
    // die Instanz ist unter diesem Namen erreichbar, APP_URL nennt
    // aber einen anderen.
    const hinweis = originRejectionHint(
      req.headers.get("origin"),
      process.env.APP_URL,
      req.headers.get("host"),
    );
    if (hinweis) log.warn({ hinweis }, "Anfrage wegen fremder Herkunft abgelehnt");
    return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  if (!(await rateLimit(
      await clientKey("upload"),
      RATE_LIMITS.upload.versuche,
      RATE_LIMITS.upload.fenster,
    ))) {
    return NextResponse.json(
      { error: "Zu viele Uploads. Bitte kurz warten." },
      { status: 429 },
    );
  }

  // Vor dem Puffern pruefen: `req.formData()` liest den KOMPLETTEN Body
  // in den Speicher, bevor irgendein Limit greift — eine 5-GB-Anfrage
  // haette den Prozess sonst schon erledigt, ehe die Groessenpruefung
  // weiter unten ueberhaupt drankommt.
  //
  // Ohne glaubwuerdige Laengenangabe wird gar nicht erst gepuffert: eine
  // Anfrage mit chunked Transfer-Encoding hat keine Content-Length, und
  // genau darueber liess sich die Pruefung vorher umgehen.
  const maxBody = uploadLimitBytes("FILE");
  const declared = declaredBodySize(
    req.headers.get("content-length"),
    maxBody + 64 * 1024,
  );
  if (declared.kind === "zu-gross") {
    // Vor dem Puffern steht die Art der Datei noch nicht fest, geprueft
    // wird deshalb an der groesseren Anhang-Grenze. Die Meldung nennt
    // trotzdem beide Zahlen: stuende dort nur die Anhang-Grenze, wuerde
    // ein 30-MB-Bild hier mit "max. 25 MB" abgelehnt, und dieselbe
    // Datei auf 20 MB verkleinert unten noch einmal mit "max. 10 MB" —
    // zwei Absagen mit zwei Zahlen, von denen die erste nie die Grenze
    // war, an der die Datei tatsaechlich scheitert.
    const grenzen =
      uploadLimitMb("IMAGE") === uploadLimitMb("FILE")
        ? `max. ${uploadLimitMb("FILE")} MB`
        : `max. ${uploadLimitMb("FILE")} MB, Bilder ${uploadLimitMb("IMAGE")} MB`;
    return NextResponse.json(
      { error: `Datei zu gross (${grenzen})` },
      { status: 413 },
    );
  }
  if (declared.kind === "unbekannt") {
    return NextResponse.json(
      { error: "Länge der Anfrage fehlt (Content-Length erforderlich)" },
      { status: 411 },
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
      { error: `Nur echte Bilder erlaubt (${IMAGE_TYPE_NAMES})` },
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
  const typ = imageType ?? mimeTypeForExtension(ext);
  // Einen Bildtyp gibt es nur gegen die Magic Bytes. Sonst entschiede
  // bei kind=file allein die vom Client gewaehlte Endung ueber den
  // gespeicherten MIME-Typ: eine Datei "x.gif" mit beliebigem Inhalt
  // bekaeme image/gif, und fileResponseHeaders liefert jeden Bildtyp
  // mit Content-Disposition: inline und genau diesem Content-Type aus —
  // eine Typangabe, die nicht zum Inhalt passt. Als octet-stream geht
  // dieselbe Datei als Download raus.
  const mimeType =
    isInlineImageType(typ) && typ !== sniffed
      ? "application/octet-stream"
      : typ;
  const name = sanitizeFilename(file.name);
  const storedName = `${randomBytes(16).toString("hex")}.${ext}`;

  const fullPath = path.join(UPLOAD_DIR, storedName);
  // Metadaten raus, BEVOR die Datei liegt. Sonst behaelt ein Foto seine
  // EXIF-Daten — GPS-Ort, Aufnahmezeit, Geraet — und /api/files, der
  // Freigabelink und die Einbettung im Export liefern sie genauso wieder
  // aus: wer ein Bild in eine Seite zieht, teilte mehr, als er sieht.
  //
  // Nur fuer erkannte Bildtypen (imageType kommt aus den Magic Bytes,
  // nicht aus der Endung) und ohne Neucodieren: lib/image-metadata laesst
  // ganze Abschnitte des Containers weg und ruehrt die Bilddaten nicht
  // an. Bei allem, was nicht aufgeht, bleibt die Datei, wie sie ist.
  const gespeicherteBytes = imageType
    ? stripImageMetadata(bytes, imageType)
    : bytes;
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(fullPath, gespeicherteBytes);
  } catch (e) {
    // Ohne diesen Zweig verliesse ein Schreibfehler (Verzeichnis nicht
    // beschreibbar, Platte voll) die Route unbehandelt: kein Eintrag im
    // Log und keine JSON-Antwort, an der sich der Client festhalten
    // koennte. Derselbe Vorfall waere je nach Ursache sichtbar oder
    // gar nicht — deshalb hier dieselbe Meldung wie im Datenbankzweig.
    log.error(
      { err: String(e), spaceId },
      "Datei konnte nicht abgelegt werden",
    );
    return NextResponse.json(
      { error: "Upload fehlgeschlagen" },
      { status: 500 },
    );
  }

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
        // Die abgelegte Groesse, nicht die hochgeladene: nach dem
        // Entfernen der Metadaten ist die Datei kleiner, und die Anzeige
        // soll die Datei beschreiben, die wirklich da liegt.
        size: gespeicherteBytes.length,
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
        size: gespeicherteBytes.length,
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
    // Ohne Datensatz keine verwaiste Datei zuruecklassen — aber nur
    // dann. `create` kann auch fehlschlagen, nachdem die Zeile
    // geschrieben ist und nur die Antwort verloren ging (Verbindung
    // weg, Timeout nach dem Commit). Ungeprueft geloescht, bliebe ein
    // Anhang in der Liste des Space stehen, dessen Bytes fehlen: der
    // Abruf ueber /api/files antwortet 404, und der Verweis laesst sich
    // nicht mehr heilen. Die Datei liegen zu lassen ist der harmlosere
    // Ausgang. Laesst sich die Zeile nicht nachsehen (Datenbank weg),
    // bleibt es beim Loeschen wie bisher.
    const angelegt = await prisma.attachment
      .findUnique({ where: { storedName }, select: { id: true } })
      .catch(() => null);
    if (!angelegt) await unlink(fullPath).catch(() => {});
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
