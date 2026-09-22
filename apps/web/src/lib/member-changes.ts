import "server-only";
import { prisma, type Prisma, type SpaceRole } from "@dokunc/db";
import { canChangeRole, canRemoveMember } from "./role-policy";
import { isSerializationConflict } from "./concurrent-change";

/**
 * Rolle aendern und Mitglied entfernen, ohne den letzten Eigentuemer zu
 * verlieren.
 *
 * Dasselbe Muster wie leaveSpaceAction (app/s/[slug]/settings/actions.ts):
 * Zaehlen und Schreiben in EINER Transaktion mit isolationLevel
 * Serializable. Vorher zaehlten changeRoleAction und removeMemberAction
 * die Owner in einer eigenen Abfrage und schrieben erst danach. Stuften
 * zwei von zwei Eigentuemern einander gleichzeitig herab (oder entfernten
 * einander), zaehlten beide zwei, beide schrieben, und der Space stand
 * ohne Eigentuemer da — genau der Zustand, den die Regel verhindern soll.
 *
 * Steht in lib/ und nicht in members/actions.ts: jene Datei traegt
 * "use server", und dort wird JEDER Export zu einem aufrufbaren
 * Endpunkt — auch ein Helfer, der die Berechtigung nicht selbst prueft.
 * Hier ruft ihn nur auf, wer ihn importiert; die Actions haben vorher
 * authorizeAction durchlaufen.
 */

type Member = { id: string; role: SpaceRole; userId: string };

export type MemberChange =
  /** Geschrieben; `member` ist der Stand VOR der Aenderung. */
  | { status: "erledigt"; member: Member }
  /** Die ID gehoert zu keinem Mitglied dieses Space (mehr). */
  | { status: "fehlt" }
  /** Die gewuenschte Rolle hatte das Mitglied schon. */
  | { status: "unveraendert" }
  /** lib/role-policy sagt nein — mit Begruendung. */
  | { status: "abgelehnt"; reason: string }
  /**
   * Serialisierungskonflikt: eine parallele Aenderung hat gewonnen. Mit
   * dem pg-Adapter meist als DriverAdapterError beim COMMIT, seltener als
   * P2034 (lib/concurrent-change, isSerializationConflict).
   */
  | { status: "gleichzeitig" };

export type MemberScope = {
  spaceId: string;
  /** Handelnde Person und ihre Rolle, wie authorizeAction sie liefert. */
  actorId: string;
  actorRole: SpaceRole;
};

const MEMBER_SELECT = { id: true, role: true, userId: true } as const;

/**
 * Nur Owner mit aktivem Konto zaehlen: ein deaktiviertes OWNER-Konto kann
 * niemanden mehr befoerdern, wuerde als Zaehler aber den letzten aktiven
 * Eigentuemer freigeben.
 *
 * Gezaehlt wird nur, wo die Zahl etwas entscheidet — die Regel fragt sie
 * allein fuer einen Eigentuemer ab, und leaveSpaceAction zaehlt ebenso
 * nur dann. Jede weitere gelesene Zeile waere in einer serialisierbaren
 * Transaktion ein Anlass fuer einen Konflikt, der keiner ist. Fuer alle
 * anderen Rollen steht die 0 also fuer "nicht gezaehlt".
 */
async function activeOwners(
  tx: Prisma.TransactionClient,
  spaceId: string,
  member: Member,
): Promise<number> {
  if (member.role !== "OWNER") return 0;
  return tx.spaceMember.count({
    where: { spaceId, role: "OWNER", user: { isActive: true } },
  });
}

export async function changeMemberRole(
  scope: MemberScope,
  memberId: string,
  nextRole: SpaceRole,
): Promise<MemberChange> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<MemberChange> => {
        // Das Mitglied in derselben Transaktion lesen: seine Rolle
        // entscheidet mit, und sie kann sich ebenso gleichzeitig aendern.
        const member = await tx.spaceMember.findFirst({
          where: { id: memberId, spaceId: scope.spaceId },
          select: MEMBER_SELECT,
        });
        if (!member) return { status: "fehlt" };

        const verdict = canChangeRole({
          actorRole: scope.actorRole,
          isSelf: member.userId === scope.actorId,
          currentRole: member.role,
          nextRole,
          ownerCount: await activeOwners(tx, scope.spaceId, member),
        });
        // Abgelehnt wird vor jedem Schreiben: die Transaktion endet dann
        // ohne Aenderung.
        if (!verdict.allowed) {
          return { status: "abgelehnt", reason: verdict.reason };
        }
        if (member.role === nextRole) return { status: "unveraendert" };

        await tx.spaceMember.update({
          where: { id: member.id },
          data: { role: nextRole },
        });
        return { status: "erledigt", member };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (isSerializationConflict(e)) return { status: "gleichzeitig" };
    throw e;
  }
}

export async function removeSpaceMember(
  scope: MemberScope,
  memberId: string,
): Promise<MemberChange> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<MemberChange> => {
        const member = await tx.spaceMember.findFirst({
          where: { id: memberId, spaceId: scope.spaceId },
          select: MEMBER_SELECT,
        });
        if (!member) return { status: "fehlt" };

        const verdict = canRemoveMember({
          actorRole: scope.actorRole,
          isSelf: member.userId === scope.actorId,
          targetRole: member.role,
          ownerCount: await activeOwners(tx, scope.spaceId, member),
        });
        if (!verdict.allowed) {
          return { status: "abgelehnt", reason: verdict.reason };
        }

        await tx.spaceMember.delete({ where: { id: member.id } });
        return { status: "erledigt", member };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (isSerializationConflict(e)) return { status: "gleichzeitig" };
    throw e;
  }
}
