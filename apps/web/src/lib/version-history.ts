import "server-only";
import { prisma } from "@dokunc/db";

/** Wie bisher 25 je Seite (history/page.tsx; Kritik 12/K11). */
export const HISTORY_PAGE_SIZE = 25;

export type HistoryCursor = { at: Date; id: string };

/** "<ms>_<id>": ueberlebt das Ausduennen der Version, auf die er zeigt. */
export function encodeHistoryCursor(v: { createdAt: Date; id: string }): string {
  return `${v.createdAt.getTime()}_${v.id}`;
}

/**
 * Gegenstueck; alles Unlesbare (auch Arrays aus searchParams) -> null.
 * Am ERSTEN "_" getrennt: ms /^\d{1,15}$/ (hoechstens 15 Ziffern, also
 * unter der Grenze von Date bei 8.64e15), id /^[A-Za-z0-9_-]{1,64}$/
 * (cuid in Betrieb, Test-IDs mit Bindestrich; Kritik 12/K3).
 */
export function parseHistoryCursor(raw: unknown): HistoryCursor | null {
  if (typeof raw !== "string") return null;
  const cut = raw.indexOf("_");
  if (cut < 0) return null;
  const ms = raw.slice(0, cut);
  const id = raw.slice(cut + 1);
  if (!/^\d{1,15}$/.test(ms)) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return { at: new Date(Number(ms)), id };
}

/**
 * Eine Seite des Verlaufs, neueste zuerst, Keyset auf (createdAt, id).
 *
 * Nur die angezeigten Felder: die Versionen mit vollem Dokument-JSON zu
 * laden, hiesse auf einer vielbearbeiteten Seite Megabytes fuer eine Liste
 * aus Name und Datum. Der Inhalt wird erst auf der Vergleichsseite
 * geladen.
 */
export async function loadVersionPage(
  pageId: string,
  cursor: HistoryCursor | null,
  size = HISTORY_PAGE_SIZE,
): Promise<{
  versions: { id: string; createdAt: Date; author: { name: string } | null }[];
  next: string | null;
}> {
  const rows = await prisma.pageVersion.findMany({
    where: {
      pageId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.at } },
              { createdAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: size + 1,
    select: { id: true, createdAt: true, author: { select: { name: true } } },
  });
  if (rows.length <= size) return { versions: rows, next: null };
  const versions = rows.slice(0, size);
  return { versions, next: encodeHistoryCursor(versions[size - 1]) };
}
