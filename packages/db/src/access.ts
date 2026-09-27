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
 * Die Regel selbst, für bereits geladene Angaben.
 *
 * `accessRootId` zeigt auf die nächste geschützte Seite Richtung Wurzel
 * (auf sich selbst, wenn die Seite selbst geschützt ist) und ist null,
 * solange nichts im Weg steht. Die Space-Verwaltung sieht alles, sonst
 * wäre ihr eigener Space nicht mehr vollständig verwaltbar.
 *
 * Wer viele Zeilen auf einmal prüft — der Collab-Server für alle offenen
 * Verbindungen, der Mail-Dispatcher für eine ganze Warteschlange — kann
 * `canSeePage` nicht je Zeile aufrufen; das wären zwei Abfragen pro
 * Person und Seite. Ohne diese Fassung schreibt jede dieser Stellen die
 * Regel selbst noch einmal hin, und eine Änderung hier (andere
 * Rollenschwelle, weitere Freigabeart) ginge an ihnen vorbei.
 */
export function canSeePageWithGrant(
  role: SpaceRole | null | undefined,
  accessRootId: string | null | undefined,
  hasGrant: boolean,
): boolean {
  if (isAtLeast(role, "ADMIN")) return true;
  if (!role) return false;
  if (!accessRootId) return true;
  return hasGrant;
}

/** Darf diese Person diese Seite sehen? Lädt die Angaben selbst. */
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

  // Die Freigabe nur laden, wenn überhaupt ein Schutz im Weg steht —
  // sonst käme zu jedem Seitenaufruf eine zweite Abfrage dazu.
  const grant = page.accessRootId
    ? await prisma.pageGrant.findFirst({
        where: {
          pageId: page.accessRootId,
          OR: [{ userId }, { group: { members: { some: { userId } } } }],
        },
        select: { id: true },
      })
    : null;
  return canSeePageWithGrant(role, page.accessRootId, !!grant);
}

/** Groesse der IN-Listen beim Pruefen vieler Personen. */
const ACCESS_CHUNK = 500;

/**
 * Von `userIds` bleibt, wer diese Seite heute sehen darf: wirksame Rolle
 * im Space (eigene Mitgliedschaft oder Gruppe) und bei einer geschuetzten
 * Seite die Freigabe am accessRoot. Eine Seite im Papierkorb sieht
 * niemand. Reihenfolge wie in `userIds`, ohne Doppelte.
 *
 * Gebuendelt fuer viele Personen (der Collab-Server fuer alle Folgenden
 * einer Seite): `canSeePage` je Person waeren zwei Abfragen pro Kopf.
 * Entschieden wird mit derselben Regel (`canSeePageWithGrant`).
 */
export async function usersWhoCanSeePage(
  pageId: string,
  userIds: readonly string[],
): Promise<string[]> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { spaceId: true, accessRootId: true, deletedAt: true },
  });
  if (!page || page.deletedAt) return [];
  const { spaceId, accessRootId } = page;

  const unique = [...new Set(userIds)];
  const roles = new Map<string, SpaceRole[]>();
  const granted = new Set<string>();
  const addRole = (userId: string, role: SpaceRole) => {
    const list = roles.get(userId);
    if (list) list.push(role);
    else roles.set(userId, [role]);
  };

  for (let i = 0; i < unique.length; i += ACCESS_CHUNK) {
    const chunk = unique.slice(i, i + ACCESS_CHUNK);
    const [members, groups, grants] = await Promise.all([
      prisma.spaceMember.findMany({
        where: { spaceId, userId: { in: chunk } },
        select: { userId: true, role: true },
      }),
      prisma.spaceGroup.findMany({
        where: {
          spaceId,
          group: { members: { some: { userId: { in: chunk } } } },
        },
        select: {
          role: true,
          group: {
            select: {
              members: {
                where: { userId: { in: chunk } },
                select: { userId: true },
              },
            },
          },
        },
      }),
      accessRootId
        ? prisma.pageGrant.findMany({
            where: { pageId: accessRootId },
            select: {
              userId: true,
              group: {
                select: {
                  members: {
                    where: { userId: { in: chunk } },
                    select: { userId: true },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);
    for (const m of members) addRole(m.userId, m.role);
    for (const g of groups) {
      for (const m of g.group.members) addRole(m.userId, g.role);
    }
    for (const grant of grants) {
      if (grant.userId) granted.add(grant.userId);
      for (const m of grant.group?.members ?? []) granted.add(m.userId);
    }
  }

  return unique.filter((userId) =>
    canSeePageWithGrant(
      strongestSpaceRole(roles.get(userId) ?? []),
      accessRootId,
      granted.has(userId),
    ),
  );
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
