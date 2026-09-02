import "server-only";
import { prisma } from "@dokunc/db";

export type Ancestor = { id: string; title: string };

/**
 * Vorfahren einer Seite (Wurzel zuerst, Elternseite zuletzt) per
 * rekursiver CTE. Die Kette endet an einer geloeschten Elternseite —
 * dieselbe Sicht wie der Seitenbaum, in dem verwaiste Seiten als
 * Wurzeln erscheinen. Space-gebunden, damit kein Fremdzugriff moeglich ist.
 */
export async function loadAncestors(
  spaceId: string,
  parentId: string | null,
): Promise<Ancestor[]> {
  if (!parentId) return [];
  const rows = await prisma.$queryRaw<
    { id: string; title: string; depth: number }[]
  >`
    WITH RECURSIVE anc AS (
      SELECT id, title, "parentId", 0 AS depth
      FROM "Page"
      WHERE id = ${parentId} AND "spaceId" = ${spaceId} AND "deletedAt" IS NULL
      UNION ALL
      SELECT p.id, p.title, p."parentId", anc.depth + 1
      FROM "Page" p JOIN anc ON p.id = anc."parentId"
      WHERE p."spaceId" = ${spaceId} AND p."deletedAt" IS NULL AND anc.depth < 64
    )
    SELECT id, title, depth FROM anc ORDER BY depth DESC
  `;
  return rows.map((r) => ({ id: r.id, title: r.title }));
}
