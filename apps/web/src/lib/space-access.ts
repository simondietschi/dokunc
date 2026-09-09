import "server-only";
import { effectiveSpaceRole, prisma, type SpaceRole } from "@dokunc/db";
import { strongestRole } from "./permissions";

/**
 * Wirksame Rolle einer Person in einem Space.
 *
 * Sie kann aus zwei Quellen kommen: der eigenen Mitgliedschaft und
 * jeder Gruppe, die dem Space zugeordnet ist. Es gilt die stärkste —
 * eine Gruppe nimmt nie weg, was jemand schon direkt hat.
 *
 * Bewusst eine einzige Stelle: jede Abfrage, die „darf diese Person
 * hier etwas" beantwortet, geht hier durch. Käme eine zweite Fassung
 * dazu, wäre die schwächere davon irgendwann die einzige, die noch
 * gepflegt wird.
 */

/** Prisma-Bedingung: Spaces, zu denen diese Person Zugang hat. */
export function accessibleSpaceWhere(userId: string) {
  return {
    OR: [
      { members: { some: { userId } } },
      { groups: { some: { group: { members: { some: { userId } } } } } },
    ],
  };
}

/**
 * Wirksame Rolle einer Person im Space — direkt und über Gruppen.
 * Die Regel liegt in `@dokunc/db`, damit der Collab-Server dieselbe
 * Antwort gibt.
 */
export const effectiveRole = effectiveSpaceRole;

/**
 * Wie `effectiveRole`, aber für einen Space, den der Aufrufer schon
 * geladen hat — inklusive der Gruppen. Spart die zweite Abfrage in
 * `loadSpace`, das ohnehin bei jedem Seitenaufruf läuft.
 */
export function roleFromLoadedSpace(space: {
  members: { role: SpaceRole }[];
  groups: { role: SpaceRole }[];
}): SpaceRole | null {
  return strongestRole([
    ...space.members.map((m) => m.role),
    ...space.groups.map((g) => g.role),
  ]);
}

/**
 * Alle Spaces, zu denen diese Person Zugang hat, mit der jeweils
 * stärksten Rolle. Grundlage für alles, was über Space-Grenzen hinweg
 * sucht (Suche, Palette, RAG).
 */
export async function accessibleSpaces(
  userId: string,
): Promise<{ spaceId: string; role: SpaceRole }[]> {
  const [members, groups] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { userId },
      select: { spaceId: true, role: true },
    }),
    prisma.spaceGroup.findMany({
      where: { group: { members: { some: { userId } } } },
      select: { spaceId: true, role: true },
    }),
  ]);

  const best = new Map<string, SpaceRole>();
  for (const row of [...members, ...groups]) {
    const strongest = strongestRole([best.get(row.spaceId), row.role]);
    if (strongest) best.set(row.spaceId, strongest);
  }
  return [...best].map(([spaceId, role]) => ({ spaceId, role }));
}
