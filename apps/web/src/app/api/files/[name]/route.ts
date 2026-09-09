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
    return new NextResponse("Nicht angemeldet", { status: 401 });
  }

  const { name } = await params;
  const full = uploadPath(name);
  if (!isSafeFilename(name) || !full) {
    return new NextResponse("Bad request", { status: 400 });
  }

  // Bewusst 404 statt 403: sonst verraet die Antwort, ob es die Datei
  // gibt. Kein Datensatz heisst auch: Reste aus der Zeit vor der
  // Registrierung bleiben unlesbar.
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
