import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { isSafeFilename, uploadPath } from "@/lib/uploads";
import {
  fileResponseHeaders,
  likeEscape,
  resolveFileAccess,
  type FileAccessDeps,
} from "@/lib/attachments";

export const runtime = "nodejs";

const attachmentSelect = {
  id: true,
  spaceId: true,
  pageId: true,
  storedName: true,
  name: true,
  mimeType: true,
  size: true,
} as const;

/** Prisma-/Dateisystem-Anbindung fuer die (reine) Zugriffslogik. */
const deps: FileAccessDeps = {
  findAttachment: (storedName) =>
    prisma.attachment.findUnique({
      where: { storedName },
      select: attachmentSelect,
    }),
  isMember: async (userId, spaceId) =>
    !!(await prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { id: true },
    })),
  findLegacyPage: async (storedName) => {
    // Altbestand ohne Datensatz: die Seite finden, deren Inhalt die Datei
    // referenziert. Parameterisiert (kein SQL aus Nutzerdaten).
    const like = `%/api/files/${likeEscape(storedName)}%`;
    const rows = await prisma.$queryRaw<{ id: string; spaceId: string }[]>(
      Prisma.sql`
        SELECT id, "spaceId" FROM "Page"
        WHERE "deletedAt" IS NULL AND content::text LIKE ${like}
        ORDER BY "updatedAt" DESC
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
  },
  fileSize: async (storedName) => {
    const full = uploadPath(storedName);
    if (!full) return null;
    try {
      const s = await stat(full);
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  },
  createAttachment: (data) =>
    prisma.attachment.create({ data, select: attachmentSelect }),
};

/**
 * Auslieferung hochgeladener Dateien — nur fuer angemeldete Mitglieder
 * des Space, zu dem der Anhang gehoert. Bilder inline, PDF auf Wunsch
 * (?inline=1) in einer CSP-Sandbox, alles andere als Download.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Nicht angemeldet", { status: 401 });
  }

  const { name } = await params;
  const full = uploadPath(name);
  if (!isSafeFilename(name) || !full) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const attachment = await resolveFileAccess(name, user.id, deps);
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
