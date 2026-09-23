import "server-only";
import { Prisma, prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { refreshAccessRoots } from "@/lib/page-access";
import { nextSiblingPosition } from "@/lib/page-position";
import { removeImportedImage } from "./files";

/**
 * Buchfuehrung eines laufenden Imports: alles, was er bisher angelegt
 * hat. Grundlage fuer `rollbackImport`, wenn der Import nach dem
 * Anlegen der Seiten abbricht — durch einen Fehler, weil die Person die
 * Anfrage abbricht oder weil die Zeit abgelaufen ist.
 *
 * Was hier NICHT abgedeckt ist: ein Prozessabsturz mitten im Import
 * (OOM, Neustart des Containers). Das Journal lebt nur im Speicher; die
 * bis dahin angelegten Seiten bleiben dann stehen, leer oder halb
 * gefuellt, und die geschriebenen Bilder mit ihnen. Dagegen hilft nur
 * ein Journal in der Datenbank (Importlauf als Zeile, Seiten daran
 * gebunden und bis zum Abschluss verborgen) mit einem Aufraeumer, der
 * liegengebliebene Laeufe beim Start entfernt.
 */
export class ImportJournal {
  /** Seiten, deren Anlage-Transaktion committet ist. */
  readonly pageIds: string[] = [];
  /** Angelegte Attachment-Zeilen. */
  readonly attachmentIds: string[] = [];
  /**
   * Geschriebene Bilddateien — sobald sie auf der Platte liegen, noch
   * vor ihrer Attachment-Zeile. Scheitert die Zeile, gehoert die Datei
   * trotzdem hierher.
   */
  readonly storedNames: string[] = [];
  private readonly pending = new Set<Promise<unknown>>();

  /**
   * Laufende Arbeit anmelden. `rewriteLinks` fordert die Bilder einer
   * Seite alle auf einmal an, runImport speichert sie nacheinander; bricht
   * der Import mittendrin ab, laeuft eines davon womoeglich noch, und
   * weitere warten in der Reihe. Eine Ruecknahme, die nicht auf sie
   * wartet, loescht die Seiten, und danach landet noch eine Datei auf der
   * Platte, die nie wieder jemand entfernt.
   */
  track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    const done = () => this.pending.delete(work);
    work.then(done, done);
    return work;
  }

  /** Wartet, bis keine angemeldete Arbeit mehr laeuft. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  get isEmpty(): boolean {
    return this.pageIds.length === 0 && this.storedNames.length === 0;
  }
}

/**
 * Der Import wurde nach dem Anlegen abgebrochen und zurueckgenommen.
 * `undone` sagt, ob das gelang. Die Ruecknahme ist eine Transaktion:
 * false heisst, es steht noch alles da, nicht ein Teil davon. `cause` ist
 * der urspruengliche Grund (Fehler, Abbruch der Anfrage, Zeitablauf).
 */
export class ImportRolledBack extends Error {
  constructor(
    readonly undone: boolean,
    cause: unknown,
  ) {
    super(undone ? "Import zurückgenommen" : "Import konnte nicht zurückgenommen werden", {
      cause,
    });
    this.name = "ImportRolledBack";
  }
}

/**
 * Obergrenze fuer die Ruecknahme. Zusammen mit der Zeitgrenze des
 * Imports (importTimeoutMs, Default 80 s) bleibt sie unter maxDuration
 * der Route (120 s), sodass auf einer Plattform, die die Grenze
 * durchsetzt, die Ruecknahme noch zu Ende kommt.
 */
const ROLLBACK_TIMEOUT_MS = 30_000;

type RollbackTarget = { spaceId: string; parentId: string | null };

/**
 * Nimmt alles zurueck, was im Journal steht. Gibt true zurueck, wenn das
 * gelang — nur dann darf die Antwort sagen, es sei nichts angelegt.
 *
 * Die Seiten werden hart geloescht, nicht in den Papierkorb gelegt: sie
 * sind Minuten alt, und ein zweiter Versuch legte sonst neben dem
 * Papierkorb-Baum einen zweiten an. Die Kaskade nimmt Links, Versionen
 * und alles andere an den Seiten mit.
 *
 * Seiten ANDERER, die inzwischen unter einer importierten Seite gelandet
 * sind (angelegt oder hineinverschoben, waehrend der Import noch lief),
 * fielen mit derselben Kaskade (`Page.parentId` ON DELETE CASCADE). Sie
 * wandern deshalb vorher an die Zielstelle des Imports, hinter die
 * vorhandenen Geschwister. Bewusst dorthin und nicht an die oberste
 * Ebene wie beim Leeren des Papierkorbs: liegt das Ziel unter einer
 * geschuetzten Seite, haben sie deren Schutz geerbt, und an der obersten
 * Ebene waeren sie ploetzlich fuer den ganzen Space offen.
 */
export async function rollbackImport(
  journal: ImportJournal,
  target: RollbackTarget,
): Promise<boolean> {
  await journal.settle();
  const pageIds = [...journal.pageIds];
  try {
    if (pageIds.length > 0 || journal.attachmentIds.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          if (pageIds.length > 0) {
            // Zeilen sperren, bevor nach fremden Kindern gesucht wird:
            // wer eine Seite unter eine davon haengt, braucht eine
            // Schluesselsperre auf die Elternzeile und wartet damit bis
            // nach dem Loeschen (und scheitert dann am Fremdschluessel),
            // statt zwischen Suche und Loeschen durchzurutschen.
            await tx.$queryRaw`
              SELECT id FROM "Page"
              WHERE id IN (${Prisma.join(pageIds)})
              FOR UPDATE
            `;
            const foreign = await tx.page.findMany({
              where: { parentId: { in: pageIds }, id: { notIn: pageIds } },
              select: { id: true },
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            });
            if (foreign.length > 0) {
              const first = await nextSiblingPosition(
                tx,
                target.spaceId,
                target.parentId,
              );
              for (let i = 0; i < foreign.length; i++) {
                await tx.page.update({
                  where: { id: foreign[i].id },
                  data: { parentId: target.parentId, position: first + i },
                });
                // Die Zugriffswurzel kam womoeglich von einer
                // importierten Seite, die jetzt verschwindet.
                await refreshAccessRoots(foreign[i].id, tx);
              }
            }
          }
          if (journal.attachmentIds.length > 0) {
            await tx.attachment.deleteMany({
              where: { id: { in: journal.attachmentIds } },
            });
          }
          if (pageIds.length > 0) {
            await tx.page.deleteMany({
              where: { id: { in: pageIds }, spaceId: target.spaceId },
            });
          }
        },
        { timeout: ROLLBACK_TIMEOUT_MS, maxWait: 10_000 },
      );
    }
  } catch (e) {
    // Die Dateien bleiben liegen: ihre Zeilen stehen noch, und eine Seite
    // mit Bild ohne Datei waere schlimmer als eine verwaiste Datei. Die
    // IDs gehoeren ins Log, damit sich der Rest von Hand finden laesst.
    log.error(
      { err: e, spaceId: target.spaceId, pageIds },
      "Import: Ruecknahme fehlgeschlagen",
    );
    return false;
  }

  // Erst nach dem Commit: eine Zeile ohne Datei waere ein kaputtes Bild,
  // eine Datei ohne Zeile nur Platz auf der Platte. Deshalb zaehlt eine
  // liegengebliebene Datei auch nicht als gescheiterte Ruecknahme: ohne
  // Zeile und ohne Seite, die sie verwendet, liefert /api/files sie
  // niemandem aus, und die Seiten sind weg — das ist, was die Antwort
  // zusagt.
  await Promise.all(
    journal.storedNames.map((name) =>
      removeImportedImage(name).catch((e: unknown) => {
        log.warn({ err: e, name }, "Import: Bilddatei bei der Ruecknahme nicht entfernt");
      }),
    ),
  );
  return true;
}
