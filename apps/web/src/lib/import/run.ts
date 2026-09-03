import "server-only";
import { prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { detectFormat } from "./detect";
import { buildImportTree, flattenTree, indexAliasKey } from "./tree";
import { markdownToDoc } from "./markdown";
import { htmlToDoc } from "./html";
import { emptyDoc } from "./doc";
import { rewriteLinks, collectWikiLinkIds, type ResolvedLink } from "./links";
import { decodeDataUrl, storeImportedImage } from "./files";
import {
  basename,
  extname,
  isPageExt,
  resolveRelative,
  stripExt,
  stripNotionSuffixes,
} from "./paths";
import { decodeText, extractText } from "./text";
import {
  DATA_IMAGE_PREFIX,
  ImportError,
  Warnings,
  type ImportFile,
  type ImportFormat,
  type ImportNode,
  type JsonNode,
} from "./types";

/** Obergrenze fuer Seiten pro Import (Transaktionsdauer, UI). */
export const IMPORT_MAX_PAGES = 2000;

export type ImportResult = {
  format: ImportFormat;
  pages: number;
  attachments: number;
  warnings: string[];
  roots: { id: string; title: string }[];
};

export type ImportOptions = {
  spaceId: string;
  userId: string;
  /** Zielelternseite (bereits gegen den Space geprueft) oder null. */
  parentId: string | null;
  files: ImportFile[];
};

type Created = { id: string; title: string; node: ImportNode };

/**
 * Orchestriert einen Import:
 * 1. Format erkennen, Seitenbaum bauen
 * 2. alle Seiten (leer) in EINER Transaktion anlegen -> IDs
 * 3. Inhalte konvertieren, Links auf die neuen IDs umschreiben, Bilder als
 *    Anhaenge speichern, Seite fuellen (Fehler einzelner Dateien werden
 *    zu Warnungen, der Rest wird importiert)
 */
export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const warnings = new Warnings();
  const warn = (m: string) => warnings.add(m);

  const format = detectFormat(opts.files);
  const { roots, count } = buildImportTree(opts.files, format, warn);
  if (count === 0) {
    throw new ImportError(
      "Keine importierbaren Seiten gefunden (.md, .markdown, .txt, .html).",
    );
  }
  if (count > IMPORT_MAX_PAGES) {
    throw new ImportError(`Zu viele Seiten (max. ${IMPORT_MAX_PAGES} pro Import).`);
  }

  // --- Schritt 2: Seiten anlegen -------------------------------------
  const created = new Map<ImportNode, Created>();
  const start =
    ((
      await prisma.page.aggregate({
        _max: { position: true },
        where: {
          spaceId: opts.spaceId,
          parentId: opts.parentId,
          deletedAt: null,
          isTemplate: false,
        },
      })
    )._max.position ?? -1) + 1;

  await prisma.$transaction(
    async (tx) => {
      const createLevel = async (
        nodes: ImportNode[],
        parentId: string | null,
        base: number,
      ) => {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const page = await tx.page.create({
            data: {
              spaceId: opts.spaceId,
              parentId,
              title: node.title.slice(0, 200) || "Untitled",
              position: base + i,
              content: emptyDoc() as object,
              textContent: "",
              lastEditedById: opts.userId,
            },
            select: { id: true, title: true },
          });
          created.set(node, { id: page.id, title: page.title, node });
          await createLevel(node.children, page.id, 0);
        }
      };
      await createLevel(roots, opts.parentId, start);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  // --- Schritt 3: Inhalte ---------------------------------------------
  const nodes = flattenTree(roots);
  const byKey = new Map<string, Created>();
  const byStripped = new Map<string, Created | null>(); // null = mehrdeutig
  const byBase = new Map<string, Created | null>();
  for (const node of nodes) {
    const c = created.get(node)!;
    const keys = [node.key];
    const alias = indexAliasKey(node);
    if (alias) keys.push(alias);
    for (const k of keys) {
      byKey.set(k, c);
      const stripped = stripNotionSuffixes(k);
      byStripped.set(stripped, byStripped.has(stripped) ? null : c);
      const base = basename(stripped).toLowerCase();
      byBase.set(base, byBase.has(base) ? null : c);
    }
  }
  const filesByPath = new Map(opts.files.map((f) => [f.path, f]));

  const imageCache = new Map<string, string | null>();
  let attachments = 0;

  async function saveImage(bytes: Uint8Array, name: string, pageId: string) {
    let stored: Awaited<ReturnType<typeof storeImportedImage>>;
    try {
      stored = await storeImportedImage(bytes);
    } catch (e) {
      // Ein Bild darf nie die ganze Seite kosten.
      log.warn({ err: String(e), name }, "Import: Bild speichern fehlgeschlagen");
      warn(`Bild "${name}" konnte nicht gespeichert werden.`);
      return null;
    }
    if (!stored.ok) {
      warn(
        stored.reason === "size"
          ? `Bild "${name}" ist groesser als 10 MB und wurde uebersprungen.`
          : `"${name}" ist kein unterstuetztes Bild (PNG, JPG, GIF, WebP).`,
      );
      return null;
    }
    await prisma.attachment.create({
      data: {
        spaceId: opts.spaceId,
        pageId,
        uploaderId: opts.userId,
        storedName: stored.file.storedName,
        name: name.slice(0, 255),
        mimeType: stored.file.mimeType,
        size: stored.file.size,
      },
    });
    attachments += 1;
    return `/api/files/${stored.file.storedName}`;
  }

  for (const node of nodes) {
    if (!node.file || !node.kind) continue;
    const page = created.get(node)!;
    const fromPath = node.file.path;

    let doc: JsonNode;
    let dataUrls: string[] = [];
    try {
      const text = decodeText(node.file.data);
      const converted =
        node.kind === "markdown" ? markdownToDoc(text) : htmlToDoc(text, format);
      doc = converted.doc;
      dataUrls = converted.dataUrls;
    } catch (e) {
      log.warn({ err: String(e), path: fromPath }, "Import: Konvertierung fehlgeschlagen");
      warn(`"${fromPath}" konnte nicht konvertiert werden; die Seite bleibt leer.`);
      continue;
    }

    const resolveLink = (href: string): ResolvedLink => {
      const target = resolveRelative(fromPath, href);
      if (!target) return null;
      const key = stripExt(target);
      const hit =
        byKey.get(key) ??
        byKey.get(target) ??
        byStripped.get(stripNotionSuffixes(key)) ??
        (!target.includes("/") ? byBase.get(basename(key).toLowerCase()) : null) ??
        null;
      if (hit) return { kind: "page", pageId: hit.id, title: hit.title };
      if (filesByPath.has(target) && !isPageExt(extname(target))) return { kind: "file" };
      return null;
    };

    const resolveImage = async (src: string): Promise<string | null> => {
      if (src.startsWith(DATA_IMAGE_PREFIX)) {
        const dataUrl = dataUrls[Number(src.slice(DATA_IMAGE_PREFIX.length))];
        const bytes = dataUrl ? decodeDataUrl(dataUrl) : null;
        return bytes ? saveImage(bytes, "eingebettetes-bild", page.id) : null;
      }
      const target = resolveRelative(fromPath, src);
      if (!target) return null;
      if (imageCache.has(target)) return imageCache.get(target)!;
      const file = filesByPath.get(target);
      const url = file ? await saveImage(file.data, basename(target), page.id) : null;
      imageCache.set(target, url);
      return url;
    };

    try {
      doc = await rewriteLinks(doc, { resolveLink, resolveImage, warn });
      const linkIds = collectWikiLinkIds(doc).filter((id) => id !== page.id);
      await prisma.$transaction([
        prisma.page.update({
          where: { id: page.id },
          data: { content: doc as object, textContent: extractText(doc) },
        }),
        ...(linkIds.length
          ? [
              prisma.pageLink.createMany({
                data: linkIds.map((targetPageId) => ({
                  sourcePageId: page.id,
                  targetPageId,
                })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    } catch (e) {
      log.warn({ err: String(e), path: fromPath }, "Import: Speichern fehlgeschlagen");
      warn(`"${fromPath}" konnte nicht gespeichert werden; die Seite bleibt leer.`);
    }
  }

  return {
    format,
    pages: count,
    attachments,
    warnings: warnings.toArray(),
    roots: roots.map((r) => {
      const c = created.get(r)!;
      return { id: c.id, title: c.title };
    }),
  };
}
