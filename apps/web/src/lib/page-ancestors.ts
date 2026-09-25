import "server-only";
import { Prisma, prisma, type SpaceRole } from "@dokunc/db";
import { seesEverything, visiblePageSql } from "./page-access";

export type Ancestor = { id: string; title: string };

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

/**
 * Vorfahren fuer viele Seiten auf einmal (Suchtreffer): eine rekursive
 * Abfrage statt einer je Treffer. Dieselben Regeln wie loadAncestors:
 * Kette endet an geloeschten und an nicht sichtbaren Elternseiten,
 * Eltern nur aus demselben Space, hoechstens 64 Stufen.
 *
 * `openSpaceIds` sind die Spaces mit Verwaltungsrolle (visiblePageSql).
 * Seiten ohne Elternseite fehlen in der Map.
 */
export async function loadAncestorPaths(
  pages: readonly { id: string; parentId: string | null; spaceId: string }[],
  userId: string,
  openSpaceIds: readonly string[],
): Promise<Map<string, Ancestor[]>> {
  const out = new Map<string, Ancestor[]>();
  const withParent = pages.filter(
    (p): p is { id: string; parentId: string; spaceId: string } =>
      p.parentId !== null,
  );
  if (withParent.length === 0) return out;
  const visible = visiblePageSql(userId, openSpaceIds);
  const rows = await prisma.$queryRaw<
    { hitId: string; id: string; title: string; depth: number }[]
  >`
    WITH RECURSIVE hit(id, "parentId", "spaceId") AS (
      VALUES ${Prisma.join(
        withParent.map(
          (p) =>
            Prisma.sql`(${p.id}::text, ${p.parentId}::text, ${p.spaceId}::text)`,
        ),
      )}
    ),
    anc AS (
      SELECT h.id AS "hitId", p.id, p.title, p."parentId", p."spaceId", 0 AS depth
      FROM hit h
      JOIN "Page" p ON p.id = h."parentId" AND p."spaceId" = h."spaceId"
      WHERE p."deletedAt" IS NULL AND ${visible}
      UNION ALL
      SELECT anc."hitId", p.id, p.title, p."parentId", p."spaceId", anc.depth + 1
      FROM anc
      JOIN "Page" p ON p.id = anc."parentId" AND p."spaceId" = anc."spaceId"
      WHERE p."deletedAt" IS NULL AND anc.depth < 64 AND ${visible}
    )
    SELECT "hitId", id, title, depth FROM anc ORDER BY "hitId", depth DESC
  `;
  for (const r of rows) {
    const list = out.get(r.hitId);
    const entry = { id: r.id, title: r.title };
    if (list) list.push(entry);
    else out.set(r.hitId, [entry]);
  }
  return out;
}
