import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { unzipSync } from "fflate";
import { prisma, type Prisma } from "@dokunc/db";
import { extractPlainText } from "@dokunc/editor";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin } from "@/lib/origin";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { can } from "@/lib/permissions";
import { log } from "@/lib/log";
import {
  UPLOAD_DIR,
  ALLOWED_IMAGE_TYPES,
  sniffImageType,
} from "@/lib/uploads";
import {
  markdownToDoc,
  planImport,
  type ImportFile,
  type LinkTarget,
} from "@/lib/import-markdown";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_UPLOAD = 50 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MAX_UNPACKED = 150 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;

export type ImportResult = {
  pages: number;
  images: number;
  skipped: string[];
  firstPageId: string | null;
};

/**
 * Markdown-Import in einen Space: ZIP (Ordner -> Seitenbaum) oder
 * einzelne .md-Dateien. Nur für Mitglieder mit Seitenrecht.
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
    select: { role: true },
  });
  if (!member || !can(member.role, "managePages")) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }
  if (!(await rateLimit(await clientKey("import"), 5, 600))) {
    return NextResponse.json(
      { error: "Zu viele Importe. Bitte kurz warten." },
      { status: 429 },
    );
  }

  const form = await req.formData();
  const parentRaw = form.get("parentId");
  const parent =
    typeof parentRaw === "string" && parentRaw
      ? await prisma.page.findFirst({
          where: { id: parentRaw, spaceId, deletedAt: null },
          select: { id: true },
        })
      : null;

  // Dateien einsammeln: ZIP entpacken oder .md direkt übernehmen.
  const files: ImportFile[] = [];
  let total = 0;
  for (const entry of form.getAll("files")) {
    if (!(entry instanceof File)) continue;
    if (entry.size > MAX_UPLOAD) {
      return NextResponse.json({ error: "Datei zu gross (max. 50 MB)" }, { status: 413 });
    }
    const bytes = new Uint8Array(await entry.arrayBuffer());
    if (/\.zip$/i.test(entry.name)) {
      let unzipped: Record<string, Uint8Array>;
      try {
        unzipped = unzipSync(bytes, {
          filter: (f) => {
            total += f.originalSize;
            return f.originalSize <= MAX_UNPACKED && total <= MAX_UNPACKED;
          },
        });
      } catch {
        return NextResponse.json({ error: "ZIP konnte nicht gelesen werden" }, { status: 400 });
      }
      for (const [p, data] of Object.entries(unzipped)) {
        if (p.endsWith("/")) continue;
        files.push({ path: p, data });
      }
    } else {
      files.push({ path: entry.name, data: bytes });
    }
    if (files.length > MAX_ENTRIES) {
      return NextResponse.json({ error: `Zu viele Dateien (max. ${MAX_ENTRIES})` }, { status: 413 });
    }
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "Keine Dateien" }, { status: 400 });
  }

  const plan = planImport(files);
  if (plan.pages.length === 0) {
    return NextResponse.json({ error: "Keine Markdown-Dateien gefunden" }, { status: 400 });
  }

  // Bilder ablegen (nur echte Bildtypen, wie beim normalen Upload).
  const imageUrl = new Map<string, string>();
  await mkdir(UPLOAD_DIR, { recursive: true });
  for (const [p, f] of plan.images) {
    if (f.data.byteLength > MAX_IMAGE) continue;
    const sniffed = sniffImageType(f.data);
    const ext = sniffed ? ALLOWED_IMAGE_TYPES[sniffed] : undefined;
    if (!ext) continue;
    const name = `${randomBytes(16).toString("hex")}.${ext}`;
    await writeFile(path.join(UPLOAD_DIR, name), f.data);
    imageUrl.set(p, `/api/files/${name}`);
  }

  // Erst alle Seiten leer anlegen (IDs für Wiki-Links), dann füllen.
  const idByKey = new Map<string, string>();
  const positionByParent = new Map<string | null, number>();
  const nextPosition = async (parentId: string | null) => {
    if (!positionByParent.has(parentId)) {
      const last = await prisma.page.findFirst({
        where: { spaceId, parentId, deletedAt: null },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      positionByParent.set(parentId, (last?.position ?? -1) + 1);
    }
    const pos = positionByParent.get(parentId)!;
    positionByParent.set(parentId, pos + 1);
    return pos;
  };

  for (const p of plan.pages) {
    const parentId = p.parentKey ? (idByKey.get(p.parentKey) ?? null) : (parent?.id ?? null);
    const created = await prisma.page.create({
      data: {
        spaceId,
        parentId,
        title: p.title.slice(0, 200),
        position: await nextPosition(parentId),
      },
      select: { id: true },
    });
    idByKey.set(p.key, created.id);
  }

  const targetFor = (key: string): LinkTarget | null => {
    const id = idByKey.get(key);
    if (!id) return null;
    const page = plan.pages.find((p) => p.key === key);
    return { pageId: id, label: page?.title ?? "Seite", icon: null };
  };

  for (const p of plan.pages) {
    if (p.markdown === null) continue;
    try {
      const doc = markdownToDoc(p.markdown, {
        dir: p.dir,
        resolveImage: (resolved) => imageUrl.get(resolved) ?? null,
        resolvePage: targetFor,
      });
      await prisma.page.update({
        where: { id: idByKey.get(p.key)! },
        data: {
          content: doc as Prisma.InputJsonValue,
          textContent: extractPlainText(doc),
        },
      });
    } catch (e) {
      log.warn({ err: String(e), key: p.key }, "Import: Seite nicht konvertiert");
      plan.skipped.push(`${p.key} (Konvertierung fehlgeschlagen)`);
    }
  }

  const result: ImportResult = {
    pages: plan.pages.length,
    images: imageUrl.size,
    skipped: plan.skipped.slice(0, 50),
    firstPageId: idByKey.get(plan.pages[0].key) ?? null,
  };
  log.info({ spaceId, userId: user.id, ...result, skipped: result.skipped.length }, "Markdown-Import");
  return NextResponse.json(result);
}
