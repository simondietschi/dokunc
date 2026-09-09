import "server-only";
import { prisma, type SpaceRole } from "@dokunc/db";
import { seesEverything, visiblePageSql } from "./page-access";

type Ancestor = { id: string; title: string };

/**
 * Vorfahren einer Seite (Wurzel zuerst, Elternseite zuletzt) per
 * rekursiver CTE. Die Kette endet an einer geloeschten Elternseite —
 * dieselbe Sicht wie der Seitenbaum, in dem verwaiste Seiten als
 * Wurzeln erscheinen. Space-gebunden, damit kein Fremdzugriff moeglich ist.
 *
 * Sie endet ausserdem an der ersten Elternseite, die diese Person nicht
 * sehen darf. Sonst waere die Kruemelspur ein Leck: wer auf einer
 * geschuetzten Seite eine Freigabe hat, sieht diese Seite zu Recht —
 * die Titel der geschuetzten Seiten darueber aber nicht. Weil die Kette
 * nach oben laeuft, schneidet die Bedingung im rekursiven Zweig genau
 * den Teil ab, der verborgen bleiben muss.
 */
export async function loadAncestors(
  spaceId: string,
  parentId: string | null,
  userId: string,
  role: SpaceRole | null | undefined,
): Promise<Ancestor[]> {
  if (!parentId) return [];
  // Die Space-Verwaltung sieht ohnehin alles; fuer sie faellt die
  // Bedingung weg (derselbe Kniff wie in der Suche).
  const visible = visiblePageSql(userId, seesEverything(role) ? [spaceId] : []);
  const rows = await prisma.$queryRaw<
    { id: string; title: string; depth: number }[]
  >`
    WITH RECURSIVE anc AS (
      SELECT p.id, p.title, p."parentId", 0 AS depth
      FROM "Page" p
      WHERE p.id = ${parentId} AND p."spaceId" = ${spaceId}
        AND p."deletedAt" IS NULL AND ${visible}
      UNION ALL
      SELECT p.id, p.title, p."parentId", anc.depth + 1
      FROM "Page" p JOIN anc ON p.id = anc."parentId"
      WHERE p."spaceId" = ${spaceId} AND p."deletedAt" IS NULL
        AND anc.depth < 64 AND ${visible}
    )
    SELECT id, title, depth FROM anc ORDER BY depth DESC
  `;
  return rows.map((r) => ({ id: r.id, title: r.title }));
}
