import "server-only";
import { prisma } from "@dokunc/db";

/**
 * Vergabe der naechsten freien Position in einer Geschwisterreihe.
 *
 * Vier Stellen legten Seiten an und rechneten sich die Position jede
 * fuer sich aus: das Anlegen einer Seite, das Anlegen aus einer Vorlage,
 * das Duplizieren und der Import. Alle vier lasen erst das Maximum und
 * schrieben danach Maximum+1. Laufen zwei davon gleichzeitig unter
 * derselben Elternseite, lesen beide dasselbe Maximum und vergeben
 * dieselbe Zahl; die Seitenleiste mischt die beiden Eintraege dann in
 * einer Reihenfolge, die niemand gewaehlt hat.
 *
 * Das Lesen in die Transaktion zu ziehen behebt es nicht: unter READ
 * COMMITTED sieht keine der beiden die noch nicht committete Zeile der
 * anderen. Es braucht eine Serialisierung, und zwar genau fuer die eine
 * betroffene Geschwisterreihe, nicht fuer den ganzen Space.
 *
 * Genau das tut `pg_advisory_xact_lock`: die Sperre gilt nur fuer diesen
 * Schluessel (Space plus Elternseite), haengt an der Transaktion und
 * faellt mit ihr weg — auch beim Abbruch, es gibt also nichts
 * freizugeben. Wer danach an die Reihe kommt, liest das Maximum in einem
 * frischen Statement-Snapshot und sieht die eben committete Zeile.
 *
 * Deshalb MUSS jeder Aufruf in einer Transaktion stehen: ausserhalb
 * einer solchen gibt Postgres die Sperre sofort wieder frei und die
 * Serialisierung ist wirkungslos.
 */

/** Transaktionsclient: nur das, was hier wirklich gebraucht wird. */
type PositionTx = Pick<typeof prisma, "$executeRaw" | "page">;

/**
 * Sperrt eine Geschwisterreihe bis zum Ende der Transaktion.
 *
 * `hashtextextended` liefert den bigint, den die Sperre erwartet.
 * Kollisionen zweier verschiedener Reihen auf denselben Hash sind
 * moeglich und harmlos: dann wartet eine Reihe unnoetig kurz, falsch
 * nummeriert wird nichts.
 */
export async function lockSiblingOrder(
  tx: PositionTx,
  spaceId: string,
  parentId: string | null,
): Promise<void> {
  const key = `page-position:${spaceId}:${parentId ?? ""}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/**
 * Naechste freie Position hinter den vorhandenen Geschwistern.
 *
 * `isTemplate` gehoert in die Bedingung, weil Vorlagen im selben Space
 * liegen, kein Elternteil haben und auf ihrer Standardposition stehen
 * bleiben. Ohne die Unterscheidung zaehlt eine Seite auf oberster Ebene
 * die Vorlagen mit und beginnt in einem Space, in dem es nur Vorlagen
 * gibt, bei 1 statt 0.
 */
export async function nextSiblingPosition(
  tx: PositionTx,
  spaceId: string,
  parentId: string | null,
  isTemplate = false,
): Promise<number> {
  await lockSiblingOrder(tx, spaceId, parentId);
  const last = await tx.page.aggregate({
    where: { spaceId, parentId, deletedAt: null, isTemplate },
    _max: { position: true },
  });
  return (last._max.position ?? -1) + 1;
}
