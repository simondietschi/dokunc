import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/session";
import { findReadableUpload } from "@/lib/upload-access";
import {
  UPLOAD_DIR,
  isSafeFilename,
  contentTypeForFile,
} from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Liefert eine hochgeladene Datei aus.
 *
 * Vorher war die Route offen: der zufällige Dateiname war der einzige
 * Schutz. Ein nicht zu erratender Link ist aber keine Zugriffskontrolle
 * — er steht im Seiteninhalt, in Exporten, im Verlauf und in
 * Proxy-Logs. Jetzt entscheidet die Mitgliedschaft im Space, zu dem die
 * Datei hochgeladen wurde.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isSafeFilename(name)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const userId = await getUserId();
  if (!userId) return new NextResponse("Nicht angemeldet", { status: 401 });

  const upload = await findReadableUpload(userId, name);
  // Bewusst 404 statt 403: sonst verrät die Antwort, ob es die Datei gibt.
  // Unbekannter Datensatz heisst auch: Reste aus der Zeit vor der
  // Registrierung bleiben unlesbar.
  if (!upload) return new NextResponse("Not found", { status: 404 });

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
        "Content-Type": upload.contentType || contentTypeForFile(name),
        // private: der Inhalt hängt an der Anmeldung, kein geteilter Cache.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
