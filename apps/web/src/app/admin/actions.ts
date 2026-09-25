"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";
import {
  ACCOUNT_DELETE_TIMEOUT_MS,
  canDeleteUser,
  orphanedSpacesFor,
  type DeletionReason,
} from "@/lib/account-deletion";
import { STATUS_REFUSAL_PARAM, type StatusRefusal } from "@/lib/account-status";
import {
  CONFLICT_QUERY,
  isSerializationConflict,
} from "@/lib/concurrent-change";
import { deleteSpaceWithUploads } from "@/lib/file-access";
import { log } from "@/lib/log";
import { redirect } from "next/navigation";

/**
 * Nach getaner Arbeit zurueck auf /admin, und zwar OHNE Kennung in der
 * Adresszeile.
 *
 * Nur revalidatePath rendert die Seite mit denselben searchParams neu.
 * Stand dort noch eine Ablehnung von vorhin, behauptete der rote Kasten
 * weiter das Gegenteil dessen, was gerade geschehen ist: "Nichts
 * geändert" ueber einem Konto, das eben verschwunden ist.
 */
function backToAdmin(): never {
  revalidatePath("/admin");
  redirect("/admin");
}

/**
 * Konflikt in einer Serializable-Transaktion: ein Log-Eintrag und die
 * Meldung, es noch einmal zu versuchen.
 */
function reportConflict(
  message: string,
  userId: string,
  actorId: string,
): never {
  log.warn({ userId, actorId }, message);
  redirect(`/admin?${CONFLICT_QUERY}`);
}

/**
 * Bricht eine Status-Transaktion ab, ohne als 500 nach aussen zu gehen:
 * der Aufrufer macht daraus Log-Eintrag und Umleitung.
 */
class StatusRefusedError extends Error {
  readonly code: StatusRefusal;
  constructor(code: StatusRefusal) {
    super(code);
    this.code = code;
  }
}

/**
 * Zaehlen und Schreiben fuer eine Aenderung, die den letzten aktiven
 * Admin treffen kann (Sperren, Adminrechte entziehen).
 *
 * In EINER Transaktion mit Serializable, wie deleteUserAction: sonst
 * zaehlen zwei Verwaltungen, die sich gleichzeitig gegenseitig sperren
 * oder herabstufen, beide zwei aktive Admins, beide schreiben, und die
 * Instanz steht ohne Admin da.
 */
async function changeUnlessLastAdmin<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  userId: string,
  actorId: string,
): Promise<T> {
  try {
    return await prisma.$transaction(run, { isolationLevel: "Serializable" });
  } catch (e) {
    if (e instanceof StatusRefusedError) {
      refuseStatusChange(e.code, userId, actorId);
    }
    if (isSerializationConflict(e)) {
      reportConflict(
        "Kontostatus-Änderung durch Admin verworfen: gleichzeitige Änderung",
        userId,
        actorId,
      );
    }
    throw e;
  }
}

/** Aktive Admins der Instanz, in der laufenden Transaktion gezaehlt. */
function countActiveAdmins(tx: Prisma.TransactionClient) {
  return tx.user.count({ where: { isAdmin: true, isActive: true } });
}

/**
 * Sperren oder Freischalten ablehnen — sichtbar statt wortlos.
 *
 * Die Admin-Seite kuendigt "deaktivieren" an, und danach passierte
 * nichts, ohne Meldung und ohne Log. Dasselbe Muster wie bei
 * deleteUserAction: ein Log-Eintrag fuer den Betrieb und eine Kennung in
 * der Adresszeile, die die Seite in bekannten Text uebersetzt
 * (lib/account-status).
 */
function refuseStatusChange(
  code: StatusRefusal,
  userId: string,
  actorId: string,
): never {
  log.warn(
    { userId, reason: code, actorId },
    "Kontostatus-Änderung durch Admin abgelehnt",
  );
  redirect(`/admin?${STATUS_REFUSAL_PARAM}=${code}`);
}

export async function toggleUserActiveAction(form: FormData) {
  const me = await requireAdmin();
  const userId = str(form, "userId");
  // sich selbst nicht sperren
  if (userId === me.id) refuseStatusChange("selbst", userId, me.id);

  const target = await changeUnlessLastAdmin(
    async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) throw new StatusRefusedError("unbekannt");
      // letzten aktiven Admin nicht sperren
      if (
        target.isActive &&
        target.isAdmin &&
        (await countActiveAdmins(tx)) <= 1
      ) {
        throw new StatusRefusedError("letzter-admin");
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          isActive: !target.isActive,
          // Deaktivieren beendet sofort alle Sessions.
          tokenVersion: target.isActive
            ? { increment: 1 }
            : target.tokenVersion,
        },
      });
      return target;
    },
    userId,
    me.id,
  );
  await audit({
    action: target.isActive
      ? "admin.user_deactivated"
      : "admin.user_activated",
    actorId: me.id,
    targetId: target.id,
    metadata: { email: target.email },
  });
  backToAdmin();
}

export async function toggleUserAdminAction(form: FormData) {
  const me = await requireAdmin();
  const userId = str(form, "userId");
  const target = await changeUnlessLastAdmin(
    async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) throw new StatusRefusedError("unbekannt");
      // Nur AKTIVE Admins zaehlen: ein gesperrtes Admin-Konto kann sich
      // nicht anmelden und haelt die Instanz sonst scheinbar am Leben,
      // waehrend in Wahrheit niemand mehr verwalten kann.
      if (
        target.isAdmin &&
        target.isActive &&
        (await countActiveAdmins(tx)) <= 1
      ) {
        // letzten Admin nicht degradieren
        throw new StatusRefusedError("letzter-admin-rechte");
      }
      await tx.user.update({
        where: { id: userId },
        data: { isAdmin: !target.isAdmin },
      });
      return target;
    },
    userId,
    me.id,
  );
  await audit({
    action: target.isAdmin ? "admin.admin_revoked" : "admin.admin_granted",
    actorId: me.id,
    targetId: target.id,
    metadata: { email: target.email },
  });
  backToAdmin();
}

/**
 * Zwei-Faktor eines Kontos zurücksetzen.
 *
 * Der Ausweg für den Fall, den es sonst nicht gäbe: Telefon weg und
 * Wiederherstellungscodes ebenso. Das Konto bleibt erreichbar, der
 * Schritt steht aber im Audit-Log und ist damit nachvollziehbar —
 * anders als eine stille Hintertür.
 */
export async function resetUserTotpAction(form: FormData) {
  const me = await requireAdmin();
  const userId = str(form, "userId");
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpEnabledAt: true },
  });
  if (!target?.totpEnabledAt) return;

  await prisma.user.update({
    where: { id: target.id },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
  });
  await prisma.totpRecoveryCode.deleteMany({ where: { userId: target.id } });
  await audit({
    action: "auth.totp_disabled",
    actorId: me.id,
    targetId: target.id,
    metadata: { email: target.email, byAdmin: true },
  });
  backToAdmin();
}

export async function deleteSpaceAction(form: FormData) {
  const me = await requireAdmin();
  const spaceId = str(form, "spaceId");
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, name: true, slug: true },
  });
  if (!space) return;

  // Harte Löschung inkl. Kaskaden (Seiten, Mitglieder, Einladungen) —
  // und der hochgeladenen Dateien, die sonst verwaist liegen bleiben.
  await deleteSpaceWithUploads(space.id);
  // Nach der Loeschung: scheitert sie (Zeitgrenze), steht kein falscher
  // Eintrag im Log. Die Eintraege des Space bleiben (AuditLog.spaceId wird
  // NULL), space.deleted traegt Name und Slug.
  await audit({
    action: "space.deleted",
    actorId: me.id,
    targetId: space.id,
    metadata: { name: space.name, slug: space.slug },
  });
  backToAdmin();
}

/**
 * Bricht die Lösch-Transaktion ab, ohne als 500 nach aussen zu gehen:
 * der Aufrufer macht daraus Log-Eintrag und Umleitung. Wie LastOwnerError
 * in app/s/[slug]/settings/actions.ts.
 */
class DeletionRefusedError extends Error {
  readonly code: DeletionReason;
  constructor(reason: string, code: DeletionReason) {
    super(reason);
    this.code = code;
  }
}

/**
 * Konto durch die Instanz-Verwaltung löschen.
 *
 * Dieselben Schranken wie beim Selbstlöschen: der letzte aktive Admin
 * bleibt, und kein Space darf ohne Eigentümer zurückbleiben.
 */
export async function deleteUserAction(form: FormData) {
  const me = await requireAdmin();
  const userId = str(form, "userId");
  if (userId === me.id) return; // dafür gibt es die Konto-Seite

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isAdmin: true },
  });
  if (!target) return;

  try {
    await prisma.$transaction(
      async (tx) => {
        const orphanedSpaces = await orphanedSpacesFor(target.id, tx);
        const activeAdmins = target.isAdmin ? await countActiveAdmins(tx) : 0;
        const verdict = canDeleteUser({
          isLastActiveAdmin: target.isAdmin && activeAdmins <= 1,
          orphanedSpaces,
        });
        if (!verdict.allowed) {
          throw new DeletionRefusedError(verdict.reason, verdict.code);
        }
        await tx.user.delete({ where: { id: target.id } });
      },
      // Serializable: sonst zaehlen zwei Verwaltungen, die gleichzeitig
      // je das Konto der anderen loeschen, beide zwei aktive Admins,
      // beide loeschen, und die Instanz steht ohne Admin da — genau der
      // Zustand, den die Pruefung verhindern soll.
      { isolationLevel: "Serializable", timeout: ACCOUNT_DELETE_TIMEOUT_MS },
    );
  } catch (e) {
    if (e instanceof DeletionRefusedError) {
      log.warn(
        { userId: target.id, reason: e.message, actorId: me.id },
        "Konto-Löschung durch Admin abgelehnt",
      );
      // Und sichtbar: die Action gibt nichts zurueck, die Admin-Seite
      // kuendigt "endgültig löschen" an, und danach passierte wortlos
      // nichts. Als Kennung, nicht als Satz — die Adresszeile ist von
      // aussen setzbar, und die Seite soll nur bekannte Texte zeigen.
      redirect(`/admin?nicht-geloescht=${e.code}`);
    }
    // Serialisierungskonflikt: eine parallele Aenderung an den Konten
    // hat gewonnen. Ein neuer Versuch sieht den aktuellen Stand.
    if (isSerializationConflict(e)) {
      reportConflict(
        "Konto-Löschung durch Admin verworfen: gleichzeitige Änderung",
        target.id,
        me.id,
      );
    }
    throw e;
  }

  // Erst nach der Transaktion protokollieren: vorher stuende eine
  // Löschung im Protokoll, die die Pruefung darin noch abgelehnt hat.
  // Handelnd ist die Verwaltung, nicht das gelöschte Konto; die
  // Beziehung auf actorId bleibt also bestehen.
  await audit({
    action: "account.deleted",
    actorId: me.id,
    targetId: target.id,
    metadata: { email: target.email, bySelf: false },
  });
  backToAdmin();
}
