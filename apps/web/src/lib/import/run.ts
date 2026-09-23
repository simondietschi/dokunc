import "server-only";
import { prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { refreshAccessRoots } from "@/lib/page-access";
import { uploadLimitBytes, uploadLimitMb } from "@/lib/uploads";
import { IMAGE_TYPE_NAMES } from "@/lib/image-types";
import { detectFormat } from "./detect";
import { buildImportTree, flattenTree, indexAliasKey } from "./tree";
import { markdownToDoc } from "./markdown";
import { htmlToDoc } from "./html";
import { emptyDoc } from "./doc";
import { rewriteLinks, collectWikiLinkIds, type ResolvedLink } from "./links";
import { decodeDataUrl, removeImportedImage, storeImportedImage } from "./files";
import { ImportJournal, ImportRolledBack, rollbackImport } from "./rollback";
import { isInfrastructureError } from "./db-errors";
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
  fileFromBytes,
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

/**
 * Ende der Hinweise zu Seiten, deren Inhalt nicht ankam. Scheitert jede
 * Seite, wird der Import zurueckgenommen, und "bleibt leer" stimmte nicht
 * mehr; fuer die Fehlermeldung faellt dieses Ende deshalb weg.
 */
const BLEIBT_LEER = "; die Seite bleibt leer.";

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
  /**
   * Abbruch der Anfrage oder eigene Zeitgrenze der Route. Geprueft wird
   * zwischen den Schritten und vor jeder Seite; was bis dahin angelegt
   * ist, wird zurueckgenommen.
   */
  signal?: AbortSignal;
};

type Created = { id: string; title: string };

/**
 * Orchestriert einen Import:
 * 1. Format erkennen, Seitenbaum bauen
 * 2. alle Seiten (leer) in EINER Transaktion anlegen -> IDs
 * 3. Inhalte konvertieren, Links auf die neuen IDs umschreiben, Bilder als
 *    Anhaenge speichern, Seite fuellen (Fehler einzelner Dateien werden
 *    zu Warnungen, der Rest wird importiert)
 *
 * Alles oder nichts ab Schritt 2: bricht der Import danach ab — ein
 * Fehler ausserhalb der einzelnen Dateien, ein Ausfall der Datenbank,
 * der Abbruch der Anfrage, die Zeitgrenze —, nimmt `rollbackImport`
 * alles zurueck, was dieser Lauf angelegt hat, und runImport wirft
 * `ImportRolledBack`. Vorher blieben bis zu 2000 leere Seiten stehen, und
 * ein zweiter Versuch legte den Baum ein zweites Mal an. Warnungen zu
 * einzelnen Dateien sind KEIN Abbruch: der Rest des Imports ist brauchbar
 * und bleibt. Scheitert dagegen JEDE Seite, bleibt nichts Brauchbares,
 * und der Import gilt als gescheitert. Einen Prozessabsturz deckt das
 * nicht ab (siehe ImportJournal).
 */
export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const warnings = new Warnings();
  const warn = (m: string) => warnings.add(m);
  const signal = opts.signal;

  const files = opts.files.filter((f) => {
    if (!isPageExt(extname(f.path)) || f.size <= MAX_PAGE_FILE_BYTES) {
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
    // Mit den Hinweisen: blieb keine Seite uebrig, weil jede Seitendatei
    // zu gross war, steht nur dort, welche.
    throw new ImportError(
      "Keine importierbaren Seiten gefunden (.md, .markdown, .txt, .html).",
      warnings.toArray(),
    );
  }
  if (count > IMPORT_MAX_PAGES) {
    throw new ImportError(`Zu viele Seiten (max. ${IMPORT_MAX_PAGES} pro Import).`);
  }
  // Bis hier ist nichts angelegt; ein Abbruch endet ohne Ruecknahme.
  signal?.throwIfAborted();

  const journal = new ImportJournal();
  try {
    return await createAndFill();
  } catch (e) {
    if (journal.isEmpty) throw e;
    const undone = await rollbackImport(journal, {
      spaceId: opts.spaceId,
      parentId: opts.parentId,
    });
    // Ohne den Fehler selbst: den protokolliert die Route mit dem Grund,
    // den nur sie einordnen kann (Zeitgrenze, Abbruch der Person, Fehler).
    const ctx = { spaceId: opts.spaceId, pages: journal.pageIds.length, undone };
    if (undone) log.warn(ctx, "Import abgebrochen und zurückgenommen");
    else log.error(ctx, "Import abgebrochen, Rücknahme gescheitert");
    throw new ImportRolledBack(undone, e);
  }

  async function createAndFill(): Promise<ImportResult> {
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
            // Innerhalb der Transaktion: ein Abbruch hier rollt Postgres
            // zurueck, es gibt noch nichts zurueckzunehmen.
            signal?.throwIfAborted();
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
      // Person bekommt einen Fehler ohne Ruecklass. (Beim Selbsthosten
      // greift maxDuration nicht; dort begrenzt importTimeoutMs() ueber
      // `signal`, und das Anlegen prueft ihn vor jeder Seite.)
      { timeout: 60_000, maxWait: 10_000 },
    );
    // Erst nach dem Commit ins Journal: scheitert die Transaktion, hat
    // Postgres die Seiten schon verworfen. (Einzige Luecke: die Verbindung
    // reisst genau beim COMMIT ab — dann ist unbekannt, ob er durchging.)
    for (const c of created.values()) journal.pageIds.push(c.id);

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

    // Dieselbe Zahl nennen, die storeImportedImage auch prueft: die
    // Grenze faellt mit MAX_UPLOAD_MB, ein fester Text "10 MB" waere bei
    // kleinerer Betriebsgrenze schlicht falsch.
    const tooLargeImage = (name: string) =>
      warn(`Bild "${name}" ist grösser als ${uploadLimitMb("IMAGE")} MB und wurde übersprungen.`);

    // Bilder eines Imports nacheinander speichern, nie gleichzeitig.
    // rewriteLinks arbeitet Geschwisterknoten mit Promise.all ab, und
    // saveImage entpackt (`read()`) und kopiert beim Entfernen der
    // Metadaten synchron, noch vor dem ersten await. Ohne die Kette lagen
    // so alle Bilder einer Seite gleichzeitig entpackt im Speicher, bei
    // PNG/JPEG samt Kopie. Gemessen auf dem echten Weg durch runImport
    // mit 20 PNG zu 9,5 MB auf einer Seite: Spitze rund 390 MB ueber dem
    // Stand davor, mit der Kette rund 40 MB (ein Bild samt Kopie und was
    // der GC noch nicht eingesammelt hat).
    let imageQueue: Promise<unknown> = Promise.resolve();
    const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
      const next = imageQueue.then(work);
      // Ein gescheitertes Bild haelt die folgenden nicht auf.
      imageQueue = next.catch(() => undefined);
      return next;
    };

    // Die Datei statt fertiger Bytes: bei Zip-Eintraegen entpackt erst
    // `read()` hier, und die Bytes sind nach dem Schreiben wieder frei.
    async function saveImage(
      file: Pick<ImportFile, "size" | "read">,
      name: string,
      pageId: string,
    ) {
      signal?.throwIfAborted();
      // Die Groesse steht fest, ohne zu entpacken. Ein Zip-Eintrag darf bis
      // ZIP_MAX_FILE (32 MB) gross sein; ihn zu entpacken, nur damit
      // storeImportedImage ihn dann wegen der Groesse ablehnt, kostete
      // genau den Speicher, den das einzelne Entpacken sparen soll.
      if (file.size > uploadLimitBytes("IMAGE")) {
        tooLargeImage(name);
        return null;
      }
      let stored: Awaited<ReturnType<typeof storeImportedImage>>;
      try {
        stored = await storeImportedImage(file.read());
      } catch (e) {
        // Ein Bild darf nie die ganze Seite kosten.
        log.warn({ err: e, name }, "Import: Bild speichern fehlgeschlagen");
        warn(`Bild "${name}" konnte nicht gespeichert werden.`);
        return null;
      }
      if (!stored.ok) {
        if (stored.reason === "size") tooLargeImage(name);
        else warn(`"${name}" ist kein unterstütztes Bild (${IMAGE_TYPE_NAMES}).`);
        return null;
      }
      journal.storedNames.push(stored.file.storedName);
      let attachment: { id: string };
      try {
        attachment = await prisma.attachment.create({
          data: {
            spaceId: opts.spaceId,
            pageId,
            uploaderId: opts.userId,
            storedName: stored.file.storedName,
            name: name.slice(0, 255),
            mimeType: stored.file.mimeType,
            size: stored.file.size,
          },
          select: { id: true },
        });
      } catch (e) {
        // Ohne Zeile ist die Datei nur Ballast, den niemand mehr findet.
        await removeImportedImage(stored.file.storedName).catch(() => undefined);
        throw e;
      }
      journal.attachmentIds.push(attachment.id);
      attachments += 1;
      return `/api/files/${stored.file.storedName}`;
    }

    // Seiten, deren Inhalt nicht ankommt, zaehlen nicht als importiert.
    // Sonst meldet das Formular gruen "N Seiten importiert", obwohl im
    // Extremfall nur leere Huellen entstanden sind und der Grund im
    // zugeklappten Hinweis-Block steht.
    let failed = 0;

    for (const node of nodes) {
      signal?.throwIfAborted();
      if (!node.file || !node.kind) continue;
      const page = created.get(node)!;
      const fromPath = node.file.path;

      let doc: JsonNode;
      let dataUrls: string[] = [];
      try {
        const text = decodeText(node.file.read());
        const converted =
          node.kind === "markdown" ? markdownToDoc(text) : htmlToDoc(text, format);
        doc = converted.doc;
        dataUrls = converted.dataUrls;
      } catch (e) {
        // Ein Abbruch ist kein Fehler dieser Datei.
        if (signal?.aborted) throw signal.reason;
        log.warn({ err: e, path: fromPath }, "Import: Konvertierung fehlgeschlagen");
        warn(`"${fromPath}" konnte nicht konvertiert werden${BLEIBT_LEER}`);
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
          return bytes
            ? journal.track(
                oneAtATime(() =>
                  saveImage(fileFromBytes("", bytes), "eingebettetes-bild", page.id),
                ),
              )
            : null;
        }
        const target = resolveRelative(fromPath, src);
        if (!target) return null;
        const cached = imageCache.get(target);
        if (cached) return cached;
        const file = filesByPath.get(target);
        const pending = file
          ? journal.track(oneAtATime(() => saveImage(file, basename(target), page.id)))
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
        if (signal?.aborted) throw signal.reason;
        // Faellt die Datenbank aus oder ist ihr Pool erschoepft, scheitert
        // nicht diese eine Datei, sondern jede folgende auch. Als Warnung
        // gezaehlt, stuende am Ende ein Import mit lauter leeren Seiten da;
        // durchgereicht nimmt die Ruecknahme ihn ganz zurueck.
        if (isInfrastructureError(e)) throw e;
        log.warn({ err: e, path: fromPath }, "Import: Speichern fehlgeschlagen");
        warn(`"${fromPath}" konnte nicht gespeichert werden${BLEIBT_LEER}`);
        failed += 1;
      }
    }

    // Auch nach der letzten Seite: wer abgebrochen hat, bekommt die
    // Antwort nicht mehr zu sehen und soll keinen Import vorfinden, von
    // dem er nichts weiss.
    signal?.throwIfAborted();

    // Keine einzige Seite hat ihren Inhalt bekommen: uebrig blieben nur
    // leere Huellen, egal ob jede Datei einzeln scheiterte oder ein
    // Fehler, den isInfrastructureError nicht kennt, alle traf. Das ist
    // kein Import mit Warnungen, sondern ein gescheiterter; die
    // Ruecknahme raeumt die Huellen weg. Die Hinweise gehen mit: sie
    // nennen die gescheiterten Dateien und ob sie beim Konvertieren oder
    // beim Speichern scheiterten (hoechstens so viele, wie `Warnings`
    // fasst, darueber nur die Anzahl), und die Person sieht sonst nur den
    // allgemeinen Satz.
    const withContent = nodes.filter((n) => n.file && n.kind).length;
    if (withContent > 0 && failed === withContent) {
      const gruende = warnings
        .toArray()
        .map((w) => (w.endsWith(BLEIBT_LEER) ? `${w.slice(0, -BLEIBT_LEER.length)}.` : w));
      throw new ImportError("Keine der Seiten konnte importiert werden.", gruende);
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
}
