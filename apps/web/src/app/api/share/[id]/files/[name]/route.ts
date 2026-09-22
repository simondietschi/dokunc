import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { resolveShare } from "@/lib/share";
import { fileResponseHeaders } from "@/lib/attachments";
import { isSafeFilename, uploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Eine einzige Antwort fuer alle Absagen: Freigabe unbekannt, Datei
 * unbekannt, Datei nicht von der Freigabe gedeckt. Unterschiedliche
 * Antworten verrieten anonymen Aufrufern, welcher der Faelle vorliegt.
 * JSON mit `error` wie in den uebrigen Routen.
 */
function nichtGefunden() {
  return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
}

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
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const token = new URL(req.url).searchParams.get("token") ?? "";
  const share = await resolveShare(id, token);
  if (!share) return nichtGefunden();

  const attachment = await prisma.attachment.findFirst({
    where: { storedName: name, spaceId: share.spaceId },
    select: { name: true, mimeType: true, pageId: true },
  });
  if (!attachment) return nichtGefunden();

  // Anhänge älterer Uploads haben keinen Seitenbezug. Ohne ihn lässt
  // sich nicht sagen, ob die Freigabe die Datei deckt — sie beim Space
  // der Freigabe zu belassen, machte einen einzigen Link zum Schlüssel
  // für alle seitenlosen Dateien des ganzen Space, auch ohne Konto.
  // Über /api/files bleiben sie mit Konto erreichbar, und zwar für alle,
  // die jede Seite sehen dürfen, in der die Datei steckt (lib/file-access,
  // pagelessAttachmentReadable).
  if (!attachment.pageId) return nichtGefunden();

  if (attachment.pageId !== share.page.id) {
    const owner = await resolveShare(id, token, attachment.pageId);
    if (!owner) return nichtGefunden();
  }

  // Erst oeffnen, dann messen, und aus genau diesem Deskriptor lesen:
  // verschwindet die Datei danach (deleteSpaceWithUploads in
  // lib/file-access), liest der Strom weiter den geoeffneten Stand. Mit
  // `stat` auf den Pfad und einem zweiten Oeffnen beim Lesen lagen
  // Content-Length und Inhalt auseinander: die Kopfzeilen waren dann
  // schon raus, statt eines 404 brach der Body mitten im Transfer ab.
  let handle;
  try {
    handle = await open(full, "r");
  } catch {
    return nichtGefunden();
  }
  const info = await handle.stat();
  if (!info.isFile()) {
    await handle.close();
    return nichtGefunden();
  }

  const wantInline = new URL(req.url).searchParams.get("inline") === "1";
  const headers = fileResponseHeaders(attachment, info.size, wantInline);

  // Der Lesestrom schliesst den Deskriptor bei "end" und bei "error"
  // (autoClose), sonst bliebe je Abruf einer offen.
  const stream = Readable.toWeb(
    handle.createReadStream({ autoClose: true }),
  ) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(stream, { headers });
}
