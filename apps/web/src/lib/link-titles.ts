import "server-only";
import { Prisma, prisma } from "@dokunc/db";
import { extractWikiLinkIds } from "@dokunc/editor";
import { visiblePagesAcrossSpaces } from "./page-access";
import { pageTitle } from "./page-title";
import { accessibleSpaces } from "./space-access";
import {
  istSeitenId,
  resolveLinkLabels,
  type LabelOptionen,
  type LinkTitles,
} from "./link-labels";

/**
 * Aktuelle Titel der Ziele von Wiki-Links, nach Sicht geprüft
 * (Hintergrund in lib/link-labels).
 */

/** Jede angefragte ID bekommt einen Eintrag; ohne Treffer null. */
function vollstaendig(
  ids: readonly string[],
  treffer: readonly { id: string; title: string }[],
): Map<string, string | null> {
  const titel = new Map<string, string | null>(ids.map((id) => [id, null]));
  for (const t of treffer) titel.set(t.id, pageTitle(t.title));
  return titel;
}

/**
 * Titel der Seiten, die diese Person öffnen darf: lebend, in einem Space
 * mit Zugang und nach dem Seitenschutz sichtbar. Ein Instanz-Admin ohne
 * Mitgliedschaft bekommt nichts, wie beim Inhalt. Ungültige IDs werden
 * nicht abgefragt und bekommen null.
 */
export async function titlesForUser(
  userId: string,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const gueltig = [...new Set(ids.filter(istSeitenId))];
  if (gueltig.length === 0) return vollstaendig(ids, []);
  const spaces = await accessibleSpaces(userId);
  const treffer = spaces.length
    ? await prisma.page.findMany({
        where: {
          id: { in: gueltig },
          deletedAt: null,
          ...visiblePagesAcrossSpaces(userId, spaces),
        },
        select: { id: true, title: true },
      })
    : [];
  return vollstaendig(ids, treffer);
}

/**
 * Titel für eine Freigabe: nur Seiten, die derselbe Link auch öffnet.
 * Das ist die freigegebene Seite und, mit Unterseiten, ihr offener,
 * lebender Unterbaum im selben Space (die Regel von resolveShare). Jede
 * andere Seite, auch eine offene desselben Space, bekommt null: sonst
 * lieferte der Link ihren aktuellen Titel an jede Person ohne Konto,
 * auch nach einer späteren Umbenennung.
 */
export async function titlesForShare(
  share: { sharedPageId: string; spaceId: string; includeChildren: boolean },
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const gueltig = [...new Set(ids.filter(istSeitenId))];
  if (gueltig.length === 0) return vollstaendig(ids, []);
  const unterbaum = share.includeChildren
    ? Prisma.sql`
        UNION ALL
        SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
        WHERE p."deletedAt" IS NULL AND p."spaceId" = ${share.spaceId}`
    : Prisma.empty;
  const treffer = await prisma.$queryRaw<{ id: string; title: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page"
      WHERE id = ${share.sharedPageId}
        AND "deletedAt" IS NULL AND "spaceId" = ${share.spaceId}
      ${unterbaum}
    )
    SELECT p.id, p.title FROM "Page" p
    WHERE p.id IN (SELECT id FROM sub)
      AND p.id IN (${Prisma.join(gueltig)})
      AND p."accessRootId" IS NULL
  `;
  return vollstaendig(ids, treffer);
}

/**
 * Inhalte für eine Person auflösen: alle Link-Ziele in einer Abfrage,
 * dann je Inhalt eine Kopie mit aktuellen Titeln (Reihenfolge wie
 * übergeben).
 */
export async function resolveForUser(
  userId: string,
  contents: readonly unknown[],
  opts: LabelOptionen,
): Promise<unknown[]> {
  const ids = [...new Set(contents.flatMap((c) => extractWikiLinkIds(c)))];
  const titles: LinkTitles = ids.length
    ? await titlesForUser(userId, ids)
    : new Map();
  return contents.map((c) => resolveLinkLabels(c, titles, opts));
}
