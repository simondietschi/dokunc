import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin } from "@/lib/origin";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { can } from "@/lib/permissions";
import { log } from "@/lib/log";
import { extractZip } from "@/lib/import/zip";
import { runImport } from "@/lib/import/run";
import { ImportError, type ImportFile } from "@/lib/import/types";
import { extname, isPageExt, normalizePath } from "@/lib/import/paths";
import { ACCEPTED_EXT, importMaxBytes, importMaxMb } from "@/lib/import/limits";

export const runtime = "nodejs";
export const maxDuration = 120;

const accepted = new Set<string>(ACCEPTED_EXT);

/**
 * POST /api/spaces/[id]/import — multipart mit `files` (mehrere) und
 * optional `parentId`. Importiert Markdown-/HTML-Dateien oder Zips
 * (Markdown-Baum, Confluence-HTML-Export, Notion-Export) als Seiten.
 * Antwort: { pages, attachments, warnings[], roots: [{id,title}] }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id: spaceId } = await params;
  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId } },
    select: { role: true, space: { select: { slug: true } } },
  });
  if (!member || !can(member.role, "managePages")) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  if (!(await rateLimit(await clientKey(`import:${user.id}`), 5, 600))) {
    return NextResponse.json(
      { error: "Zu viele Importe. Bitte in ein paar Minuten erneut versuchen." },
      { status: 429 },
    );
  }

  const maxBytes = importMaxBytes();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes + 64 * 1024) {
    return NextResponse.json(
      { error: `Upload zu gross (max. ${importMaxMb()} MB).` },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) {
    return NextResponse.json({ error: "Keine Datei ausgewählt" }, { status: 400 });
  }
  const total = uploads.reduce((n, f) => n + f.size, 0);
  if (total > maxBytes) {
    return NextResponse.json(
      { error: `Upload zu gross (max. ${importMaxMb()} MB).` },
      { status: 413 },
    );
  }

  // Zielelternseite: muss zu DIESEM Space gehoeren (ID kommt vom Client).
  const requestedParent = String(form.get("parentId") ?? "").trim();
  let parentId: string | null = null;
  if (requestedParent) {
    const parent = await prisma.page.findFirst({
      where: { id: requestedParent, spaceId, deletedAt: null, isTemplate: false },
      select: { id: true },
    });
    if (!parent) {
      return NextResponse.json(
        { error: "Zielseite nicht gefunden" },
        { status: 400 },
      );
    }
    parentId = parent.id;
  }

  const files: ImportFile[] = [];
  const warnings: string[] = [];
  try {
    for (const upload of uploads) {
      const ext = extname(upload.name);
      if (!accepted.has(ext)) {
        warnings.push(`"${upload.name}" uebersprungen: nicht unterstuetztes Format.`);
        continue;
      }
      const bytes = new Uint8Array(await upload.arrayBuffer());
      if (ext === "zip") {
        const zip = extractZip(bytes);
        files.push(...zip.files);
        for (const name of zip.rejected) {
          warnings.push(`Zip-Eintrag "${name}" abgelehnt (unsicherer Pfad).`);
        }
        continue;
      }
      // Einzeldatei: nur der Dateiname zaehlt (nie als Pfad verwendet).
      const path =
        normalizePath(upload.name.split(/[\\/]/).pop() ?? "") ??
        `import-${files.length + 1}.${ext}`;
      files.push({ path: isPageExt(ext) ? path : `${path}.md`, data: bytes });
    }

    const result = await runImport({ spaceId, userId: user.id, parentId, files });
    revalidatePath(`/s/${member.space.slug}`, "layout");
    log.info(
      { spaceId, userId: user.id, pages: result.pages, format: result.format },
      "Import abgeschlossen",
    );
    return NextResponse.json({
      ...result,
      warnings: [...warnings, ...result.warnings],
    });
  } catch (e) {
    if (e instanceof ImportError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    log.error({ err: String(e), spaceId }, "Import fehlgeschlagen");
    return NextResponse.json(
      { error: "Import fehlgeschlagen. Bitte Datei prüfen und erneut versuchen." },
      { status: 500 },
    );
  }
}
