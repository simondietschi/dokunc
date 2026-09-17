import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { isSafeFilename, uploadPath } from "@/lib/uploads";
import { findReadableAttachment } from "@/lib/file-access";
import { fileResponseHeaders } from "@/lib/attachments";

export const runtime = "nodejs";

/**
 * Auslieferung hochgeladener Dateien.
 *
 * Frueher war die Route offen: der zufaellige Dateiname war der einzige
 * Schutz. Ein nicht zu erratender Link ist aber keine Zugriffskontrolle
 * — er steht im Seiteninhalt, in Exporten, im Verlauf und in
 * Proxy-Logs. Jetzt entscheidet der Zugang zum Space (direkt oder ueber
 * eine Gruppe) und, wenn der Anhang an einer Seite haengt, deren
 * Sichtbarkeit. Bilder gehen inline raus, PDF nur auf Wunsch
 * (?inline=1) in einer CSP-Sandbox, alles andere als Download.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  // Volle Pruefung statt blossem Token-Dekodieren: eine widerrufene
  // Sitzung soll auch keine Dateien mehr bekommen.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  const { name } = await params;
  const full = uploadPath(name);
  if (!isSafeFilename(name) || !full) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  // Bewusst 404 statt 403: sonst verraet die Antwort, ob es die Datei
  // gibt. Kein Datensatz heisst auch: Reste aus der Zeit vor der
  // Registrierung bleiben unlesbar.
  const attachment = await findReadableAttachment(name, user.id);
  if (!attachment) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  // Erst oeffnen, dann messen, und aus genau diesem Deskriptor lesen:
  // wird die Datei danach geloescht oder ersetzt (deleteSpaceWithUploads
  // in lib/file-access), liest der Strom weiter den geoeffneten Stand.
  // Mit `stat` auf den Pfad und einem zweiten Oeffnen beim Lesen lagen
  // Content-Length und Inhalt auseinander: die Kopfzeilen waren dann
  // schon raus, statt eines 404 brach der Body mitten im Transfer ab.
  let handle;
  try {
    handle = await open(full, "r");
  } catch {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const s = await handle.stat();
  if (!s.isFile()) {
    await handle.close();
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const wantInline = new URL(req.url).searchParams.get("inline") === "1";
  const headers = fileResponseHeaders(attachment, s.size, wantInline);

  // Der Lesestrom schliesst den Deskriptor bei "end" und bei "error"
  // (autoClose), sonst bliebe je Abruf einer offen.
  const stream = Readable.toWeb(
    handle.createReadStream({ autoClose: true }),
  ) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(stream, { headers });
}
