import "server-only";
import {
  Prisma,
  canSeePage,
  isAtLeast,
  prisma,
  refreshAccessRoots,
  type SpaceRole,
} from "@dokunc/db";
import { effectiveRole } from "./space-access";

export { canSeePage, refreshAccessRoots };

/**
 * Geschützte Seiten.
 *
 * Eine Seite lässt sich schützen; der Schutz vererbt sich auf den
 * ganzen Unterbaum. Sichtbar ist sie dann nur für die eingetragenen
 * Personen und Gruppen — und für die Space-Verwaltung, die sonst einen
 * Teil ihres eigenen Space nicht mehr verwalten könnte.
 *
 * Die teure Frage wäre „gibt es über mir eine geschützte Seite". Sie
 * ist deshalb materialisiert: `Page.accessRootId` zeigt auf die nächste
 * geschützte Seite Richtung Wurzel (auf sich selbst, wenn die Seite
 * selbst geschützt ist) und ist null, solange nichts im Weg steht.
 * `refreshAccessRoots` hält das nach jedem Umhängen und jeder Änderung
 * am Schutz nach.
 */

/** Verwaltung sieht den ganzen Space, sonst wäre er nicht verwaltbar. */
export function seesEverything(role: SpaceRole | null | undefined): boolean {
  return isAtLeast(role, "ADMIN");
}

/**
 * Prisma-Bedingung für jede Abfrage, die Seiten an eine Person
 * ausliefert. Für die Verwaltung leer, sonst: offen oder ausdrücklich
 * freigegeben.
 */
export function visiblePageWhere(
  userId: string,
  role: SpaceRole | null | undefined,
): Prisma.PageWhereInput {
  if (seesEverything(role)) return {};
  return {
    OR: [
      { accessRootId: null },
      { accessRoot: { grants: { some: grantWhere(userId) } } },
    ],
  };
}

/**
 * Sichtbare Seiten über mehrere Spaces hinweg (Suche, Palette, RAG).
 *
 * Pro Space gilt eine eigene Rolle, also zerfällt die Bedingung in zwei
 * Hälften: Spaces, in denen die Person verwaltet und alles sieht, und
 * der Rest, in dem nur Offenes und ausdrücklich Freigegebenes zählt.
 */
export function visiblePagesAcrossSpaces(
  userId: string,
  spaces: readonly { spaceId: string; role: SpaceRole }[],
): Prisma.PageWhereInput {
  const managed = spaces.filter((s) => seesEverything(s.role));
  const rest = spaces.filter((s) => !seesEverything(s.role));
  const clauses: Prisma.PageWhereInput[] = [];
  if (managed.length) {
    clauses.push({ spaceId: { in: managed.map((s) => s.spaceId) } });
  }
  if (rest.length) {
    clauses.push({
      spaceId: { in: rest.map((s) => s.spaceId) },
      ...visiblePageWhere(userId, "MEMBER"),
    });
  }
  // Ohne Space kein Treffer — und niemals eine leere Bedingung, die
  // versehentlich alles freigäbe.
  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}

/**
 * Dieselbe Sichtbarkeitsregel als SQL-Baustein, für die beiden
 * Rohabfragen (Volltextsuche und Rückgriff der KI). Erwartet die
 * Seitentabelle unter dem Alias `p`.
 *
 * Bewusst hier neben der Prisma-Fassung: die zwei Formulierungen
 * dürfen nie auseinanderlaufen, und nebeneinander fällt es auf.
 */
export function visiblePageSql(
  userId: string,
  openSpaceIds: readonly string[],
): Prisma.Sql {
  return Prisma.sql`(
    p."accessRootId" IS NULL
    OR p."spaceId" IN (${
      openSpaceIds.length ? Prisma.join(openSpaceIds) : Prisma.sql`NULL`
    })
    OR EXISTS (
      SELECT 1 FROM "PageGrant" g
      WHERE g."pageId" = p."accessRootId"
        AND (
          g."userId" = ${userId}
          OR EXISTS (
            SELECT 1 FROM "GroupMember" gm
            WHERE gm."groupId" = g."groupId" AND gm."userId" = ${userId}
          )
        )
    )
  )`;
}

function grantWhere(userId: string): Prisma.PageGrantWhereInput {
  return {
    OR: [{ userId }, { group: { members: { some: { userId } } } }],
  };
}

/**
 * Rolle im Space der Seite — aber nur, wenn die Seite auch sichtbar ist.
 *
 * Der eine Aufruf, den jede Route braucht, die eine einzelne Seite
 * ausliefert (Ansicht, Druck, Export, Ticket). Rückgabe null heisst
 * schlicht: kein Zugriff, egal an welcher der beiden Hürden es lag.
 */
export async function readablePageRole(
  userId: string,
  pageId: string,
  spaceId: string,
): Promise<SpaceRole | null> {
  const role = await effectiveRole(userId, spaceId);
  if (!role) return null;
  return (await canSeePage(pageId, userId, role)) ? role : null;
}

/**
 * Von einer Empfängerliste bleibt übrig, wer die Seite auch öffnen darf.
 *
 * Gedacht für Benachrichtigungen: sonst erführe jemand über die Glocke
 * oder per E-Mail von einem Kommentar auf einer Seite, die für ihn gar
 * nicht existiert — samt Titel und Textauszug.
 */
export async function filterByPageAccess<T extends { id: string }>(
  pageId: string,
  users: readonly T[],
): Promise<T[]> {
  if (users.length === 0) return [];
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { accessRootId: true, spaceId: true },
  });
  if (!page) return [];
  if (!page.accessRootId) return [...users];

  const [grants, managers, managingGroups] = await Promise.all([
    prisma.pageGrant.findMany({
      where: { pageId: page.accessRootId },
      select: {
        userId: true,
        group: { select: { members: { select: { userId: true } } } },
      },
    }),
    // Die Space-Verwaltung sieht ohnehin jede Seite.
    prisma.spaceMember.findMany({
      where: { spaceId: page.spaceId, role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    }),
    prisma.spaceGroup.findMany({
      where: { spaceId: page.spaceId, role: "ADMIN" },
      select: { group: { select: { members: { select: { userId: true } } } } },
    }),
  ]);

  const allowed = new Set<string>();
  for (const grant of grants) {
    if (grant.userId) allowed.add(grant.userId);
    for (const m of grant.group?.members ?? []) allowed.add(m.userId);
  }
  for (const m of managers) allowed.add(m.userId);
  for (const g of managingGroups) {
    for (const m of g.group.members) allowed.add(m.userId);
  }
  return users.filter((u) => allowed.has(u.id));
}

/**
 * Schutz einer Seite setzen oder aufheben.
 *
 * Wer schützt, wird selbst eingetragen: sonst verschwindet die Seite
 * im selben Moment aus der eigenen Ansicht, sobald die Person nicht
 * zur Space-Verwaltung gehört.
 *
 * Alle drei Schritte in EINEM Zug. Nacheinander ausgeführt gibt es
 * zwischen dem Setzen des Schutzes und dem Eintrag ein Fenster, in dem
 * die Seite geschützt ist und niemanden zulässt — wer in diesem Moment
 * liest, sieht eine Seite, die selbst der schützenden Person entzogen
 * ist. Genau das trat auf: die Datenbank war am Ende richtig, ein Aufruf
 * mitten im Vorgang zeigte trotzdem "Zugriff haben (0)".
 */
export async function setPageRestricted(
  pageId: string,
  restricted: boolean,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.page.update({
      where: { id: pageId },
      data: { isRestricted: restricted },
    });
    if (restricted) {
      await tx.pageGrant.upsert({
        where: { pageId_userId: { pageId, userId: actorId } },
        create: { pageId, userId: actorId },
        update: {},
      });
    } else {
      await tx.pageGrant.deleteMany({ where: { pageId } });
    }
    await refreshAccessRoots(pageId, tx);
  });
}
