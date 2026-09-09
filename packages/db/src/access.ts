import { prisma } from "./index";
import type { SpaceRole } from "./generated/prisma/client";

/**
 * Zugriffsregeln, die beide Anwendungen brauchen.
 *
 * Sie liegen hier und nicht in der Web-App, weil der Collab-Server
 * dieselbe Antwort geben muss: er entscheidet bei jeder WebSocket-
 * Verbindung neu, ob jemand eine Seite öffnen darf. Zwei Fassungen
 * derselben Regel wären zwei Fassungen mit unterschiedlichen Lücken.
 *
 * Die Prisma-Bedingungen für Listenabfragen bleiben in der Web-App —
 * nur dort werden ganze Listen gefiltert.
 */

const RANK: Record<SpaceRole, number> = {
  VIEWER: 1,
  MEMBER: 2,
  ADMIN: 3,
  OWNER: 4,
};

/** Stärkste Rolle aus mehreren Quellen (eigene Mitgliedschaft, Gruppen). */
export function strongestSpaceRole(
  roles: readonly (SpaceRole | null | undefined)[],
): SpaceRole | null {
  let best: SpaceRole | null = null;
  for (const role of roles) {
    if (!role) continue;
    if (!best || RANK[role] > RANK[best]) best = role;
  }
  return best;
}

export function isAtLeast(
  role: SpaceRole | null | undefined,
  min: SpaceRole,
): boolean {
  return !!role && RANK[role] >= RANK[min];
}

/**
 * Wirksame Rolle einer Person in einem Space: das Stärkste aus eigener
 * Mitgliedschaft und allen Gruppen, die dem Space zugeordnet sind.
 */
export async function effectiveSpaceRole(
  userId: string,
  spaceId: string,
): Promise<SpaceRole | null> {
  const [direct, viaGroups] = await Promise.all([
    prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId, spaceId } },
      select: { role: true },
    }),
    prisma.spaceGroup.findMany({
      where: { spaceId, group: { members: { some: { userId } } } },
      select: { role: true },
    }),
  ]);
  return strongestSpaceRole([direct?.role, ...viaGroups.map((g) => g.role)]);
}

/**
 * Darf diese Person diese Seite sehen?
 *
 * `accessRootId` zeigt auf die nächste geschützte Seite Richtung Wurzel
 * (auf sich selbst, wenn die Seite selbst geschützt ist) und ist null,
 * solange nichts im Weg steht. Die Space-Verwaltung sieht alles, sonst
 * wäre ihr eigener Space nicht mehr vollständig verwaltbar.
 */
export async function canSeePage(
  pageId: string,
  userId: string,
  role: SpaceRole | null | undefined,
): Promise<boolean> {
  if (isAtLeast(role, "ADMIN")) return true;
  if (!role) return false;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { accessRootId: true },
  });
  if (!page) return false;
  if (!page.accessRootId) return true;

  const grant = await prisma.pageGrant.findFirst({
    where: {
      pageId: page.accessRootId,
      OR: [{ userId }, { group: { members: { some: { userId } } } }],
    },
    select: { id: true },
  });
  return !!grant;
}

/**
 * Schreibt `accessRootId` für eine Seite und ihren Unterbaum neu.
 *
 * Eine einzige rekursive Anweisung statt einer Schleife in der App:
 * beim Umhängen eines grossen Astes wären das sonst hunderte Abfragen,
 * und ein Abbruch mittendrin liesse Seiten sichtbar, die es nicht sein
 * dürfen.
 */
export async function refreshAccessRoots(
  pageId: string,
  /**
   * Optional der Client einer laufenden Transaktion. Wer die Wurzeln
   * beim Umhaengen nachzieht, muss das im selben Zug tun: sonst steht
   * der Zug schon in der Datenbank, wenn das Nachziehen scheitert.
   */
  tx: Pick<typeof prisma, "$executeRaw"> = prisma,
): Promise<void> {
  await tx.$executeRaw`
    WITH RECURSIVE seed AS (
      SELECT p.id,
             CASE
               WHEN p."isRestricted" THEN p.id
               ELSE parent."accessRootId"
             END AS root
      FROM "Page" p
      LEFT JOIN "Page" parent ON parent.id = p."parentId"
      WHERE p.id = ${pageId}
    ),
    sub AS (
      SELECT id, root FROM seed
      UNION ALL
      SELECT c.id,
             CASE WHEN c."isRestricted" THEN c.id ELSE s.root END
      FROM "Page" c
      JOIN sub s ON c."parentId" = s.id
    )
    UPDATE "Page" p
    SET "accessRootId" = sub.root
    FROM sub
    WHERE p.id = sub.id
      AND p."accessRootId" IS DISTINCT FROM sub.root
  `;
}
