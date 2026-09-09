import "server-only";
import { prisma } from "@dokunc/db";
import { clientIp } from "./client-ip";
import { log } from "./log";

/**
 * Sicherheitsrelevante Ereignisse. Als Union statt freier String, damit
 * ein Tippfehler am Aufrufort den Typecheck bricht und die Admin-Ansicht
 * jeden Schlüssel übersetzen kann.
 */
export type AuditAction =
  | "auth.login_succeeded"
  | "auth.login_failed"
  | "auth.registered"
  | "auth.password_changed"
  | "auth.password_reset"
  | "auth.sessions_revoked"
  | "auth.totp_enabled"
  | "auth.totp_disabled"
  | "auth.recovery_codes_renewed"
  | "account.exported"
  | "account.deleted"
  | "auth.session_revoked"
  | "member.invited"
  | "member.invite_revoked"
  | "member.invite_accepted"
  | "member.role_changed"
  | "member.removed"
  | "space.created"
  | "space.updated"
  | "space.joined"
  | "space.left"
  | "space.deleted"
  | "page.deleted"
  | "page.restored"
  | "page.purged"
  | "page.version_restored"
  | "page.shared"
  | "page.share_revoked"
  | "upload.created"
  | "admin.user_activated"
  | "admin.user_deactivated"
  | "admin.admin_granted"
  | "admin.admin_revoked";

export type AuditEntry = {
  action: AuditAction;
  /** Null, wenn die handelnde Person unbekannt ist (fehlgeschlagene Anmeldung). */
  actorId?: string | null;
  spaceId?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Schreibt einen Audit-Eintrag.
 *
 * Bewusst nie werfend: ein nicht schreibbares Protokoll darf die
 * eigentliche Aktion nicht kippen (sonst wird eine volle Platte zum
 * Totalausfall). Der Fehlschlag landet stattdessen laut im Log.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        spaceId: entry.spaceId ?? null,
        targetId: entry.targetId ?? null,
        metadata: (entry.metadata ?? undefined) as never,
        ip: await clientIp(),
      },
    });
  } catch (e) {
    log.error(
      { err: String(e), action: entry.action },
      "audit-Eintrag konnte nicht geschrieben werden",
    );
  }
}

/** Menschenlesbare Beschriftung für die Admin-Ansicht. */
export const AUDIT_LABELS: Record<AuditAction, string> = {
  "auth.login_succeeded": "Anmeldung",
  "auth.login_failed": "Fehlgeschlagene Anmeldung",
  "auth.registered": "Registrierung",
  "auth.password_changed": "Passwort geändert",
  "auth.password_reset": "Passwort zurückgesetzt",
  "auth.sessions_revoked": "Überall abgemeldet",
  "auth.totp_enabled": "Zwei-Faktor aktiviert",
  "auth.totp_disabled": "Zwei-Faktor deaktiviert",
  "auth.recovery_codes_renewed": "Wiederherstellungscodes erneuert",
  "account.exported": "Daten exportiert",
  "account.deleted": "Konto gelöscht",
  "auth.session_revoked": "Gerät abgemeldet",
  "member.invited": "Einladung verschickt",
  "member.invite_revoked": "Einladung zurückgezogen",
  "member.invite_accepted": "Einladung angenommen",
  "member.role_changed": "Rolle geändert",
  "member.removed": "Mitglied entfernt",
  "space.created": "Space angelegt",
  "space.updated": "Space geändert",
  "space.joined": "Space beigetreten",
  "space.left": "Space verlassen",
  "space.deleted": "Space gelöscht",
  "page.deleted": "Seite in den Papierkorb",
  "page.restored": "Seite wiederhergestellt",
  "page.purged": "Seite endgültig gelöscht",
  "page.version_restored": "Version wiederhergestellt",
  "page.shared": "Seite freigegeben",
  "page.share_revoked": "Freigabe zurückgezogen",
  "upload.created": "Datei hochgeladen",
  "admin.user_activated": "Konto aktiviert",
  "admin.user_deactivated": "Konto deaktiviert",
  "admin.admin_granted": "Admin-Recht vergeben",
  "admin.admin_revoked": "Admin-Recht entzogen",
};

export function auditLabel(action: string): string {
  return AUDIT_LABELS[action as AuditAction] ?? action;
}
