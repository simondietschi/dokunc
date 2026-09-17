import "server-only";
import { prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { refreshAccessRoots } from "@/lib/page-access";
import { uploadLimitMb } from "@/lib/uploads";
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
import { DEFAULT_PAGE_TITLE } from "@/lib/page-title";
import { nextSiblingPosition } from "@/lib/page-position";

/** Obergrenze fuer Seiten pro Import (Transaktionsdauer, UI). */
const IMPORT_MAX_PAGES = 2000;
/** Groessere Seitendateien werden nicht konvertiert (Speicher, Laufzeit). */
const MAX_PAGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

type ImportResult = {
  format: ImportFormat;
  pages: number;
  /**
   * Angelegte Seiten, die leer geblieben sind (Konvertierung oder
   * Speichern fehlgeschlagen). Gehoert in die Antwort, weil das Formular
   * sonst nicht unterscheiden kann, ob ein Import glatt durchlief oder
   * nur zum Teil: `pages` sieht in beiden Faellen gleich aus, und der
   * Grund steht nur im zugeklappten Hinweis-Block.
   */
  failed: number;
  attachments: number;
  warnings: string[];
  roots: { id: string; title: string }[];
};

type ImportOptions = {
  spaceId: string;
  userId: string;
  /** Zielelternseite (bereits gegen den Space geprueft) oder null. */
  parentId: string | null;
  files: ImportFile[];
};

type Created = { id: string; title: string };

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

  const files = opts.files.filter((f) => {
    if (!isPageExt(extname(f.path)) || f.data.length <= MAX_PAGE_FILE_BYTES) {
      return true;
    }
    warn(
      `"${f.path}" übersprungen: grösser als ${Math.round(
        MAX_PAGE_FILE_BYTES / 1024 / 1024,
      )} MB.`,
    );
    return false;
  });
  const format = detectFormat(files);
  const { roots, count } = buildImportTree(files, format, warn);
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
  // Startposition erst in der Transaktion unten, nicht hier: nur
  // dort haelt die Sperre aus lib/page-position.

  await prisma.$transaction(
    async (tx) => {
      // Ohne Sperre lesen zwei gleichzeitige Importe in dieselbe
      // Geschwisterreihe dasselbe Maximum und vergeben danach
      // dieselben Positionen; die Seitenleiste mischt beide Baeume
      // dann ineinander. nextSiblingPosition sperrt genau diese eine
      // Reihe bis zum Ende der Transaktion. Gesperrt wird nur die
      // oberste Ebene — die tieferen haengen an Seiten, die es vor
      // diesem Import nicht gab.
      const start = await nextSiblingPosition(tx, opts.spaceId, opts.parentId);
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
              title: node.title.slice(0, 200) || DEFAULT_PAGE_TITLE,
              position: base + i,
              content: emptyDoc() as object,
              textContent: "",
              lastEditedById: opts.userId,
            },
            select: { id: true, title: true },
          });
          created.set(node, { id: page.id, title: page.title });
          await createLevel(node.children, page.id, 0);
        }
      };
      await createLevel(roots, opts.parentId, start);
      // Liegt das Ziel unter einer geschützten Seite, erben die neuen
      // Seiten deren Schutz. Ohne dieses Nachziehen steht jede
      // importierte Seite mit accessRootId null da, und genau das wertet
      // jede Prüfung (canSeePage, visiblePageWhere, visiblePageSql) als
      // offen: der ganze Import wäre für den ganzen Space lesbar.
      // Im selben Zug wie das Anlegen, sonst steht der Baum schon in der
      // Datenbank, wenn das Nachziehen scheitert.
      if (opts.parentId) {
        for (const node of roots) {
          const page = created.get(node);
          if (page) await refreshAccessRoots(page.id, tx);
        }
      }
    },
    // Nur die halbe Zeit, die die Route hat (maxDuration 120 s): dauert
    // das Anlegen bis an die 120 s, committet diese Transaktion genau
    // dann, wenn die Funktion abgeschnitten wird — im Space blieben bis
    // zu 2000 leere Seiten stehen, ohne dass Schritt 3 je zum Zug kaeme.
    // Laeuft sie stattdessen ab, rollt Postgres alles zurueck und die
    // Person bekommt einen Fehler ohne Ruecklass.
    { timeout: 60_000, maxWait: 10_000 },
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
  const filesByPath = new Map(files.map((f) => [f.path, f]));

  // Gemerkt wird das laufende Speichern, nicht erst dessen Ergebnis:
  // rewriteLinks arbeitet Geschwisterknoten mit Promise.all ab, zwei
  // Bildknoten derselben Quelle liefen sonst beide durch das Fenster
  // zwischen Pruefung und Eintrag — die Datei laege zweimal im
  // Upload-Verzeichnis, mit zwei Attachment-Zeilen und zu hohem Zaehler.
  const imageCache = new Map<string, Promise<string | null>>();
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
          ? // Dieselbe Zahl nennen, die storeImportedImage auch prueft:
            // die Grenze faellt mit MAX_UPLOAD_MB, ein fester Text "10 MB"
            // waere bei kleinerer Betriebsgrenze schlicht falsch.
            `Bild "${name}" ist grösser als ${uploadLimitMb("IMAGE")} MB und wurde übersprungen.`
          : `"${name}" ist kein unterstütztes Bild (PNG, JPG, GIF, WebP).`,
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

  // Seiten, deren Inhalt nicht ankommt, zaehlen nicht als importiert.
  // Sonst meldet das Formular gruen "N Seiten importiert", obwohl im
  // Extremfall nur leere Huellen entstanden sind und der Grund im
  // zugeklappten Hinweis-Block steht.
  let failed = 0;

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
      failed += 1;
      continue;
    }

    const resolveLink = (href: string): ResolvedLink => {
      const target = resolveRelative(fromPath, href);
      if (!target) return null;
      const key = stripExt(target);
      // Nur ein Dateiname ohne Verzeichnis ("[[Seite]]", "Seite.md"): darf
      // auf eine eindeutig benannte Seite irgendwo im Import zeigen.
      const bare = !/[\\/]/.test(href.split(/[#?]/)[0].trim());
      const hit =
        byKey.get(key) ??
        byKey.get(target) ??
        byStripped.get(stripNotionSuffixes(key)) ??
        (bare ? byBase.get(basename(key).toLowerCase()) : null) ??
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
      const cached = imageCache.get(target);
      if (cached) return cached;
      const file = filesByPath.get(target);
      const pending = file
        ? saveImage(file.data, basename(target), page.id)
        : Promise.resolve(null);
      imageCache.set(target, pending);
      return pending;
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
      failed += 1;
    }
  }

  return {
    format,
    pages: count - failed,
    failed,
    attachments,
    warnings: warnings.toArray(),
    roots: roots.map((r) => {
      const c = created.get(r)!;
      return { id: c.id, title: c.title };
    }),
  };
}
