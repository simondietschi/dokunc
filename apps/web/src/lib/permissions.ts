import type { SpaceRole } from "@dokunc/db";

export type Action = "read" | "write" | "managePages" | "manageSpace";

const MATRIX: Record<SpaceRole, Record<Action, boolean>> = {
  OWNER: { read: true, write: true, managePages: true, manageSpace: true },
  ADMIN: { read: true, write: true, managePages: true, manageSpace: true },
  MEMBER: { read: true, write: true, managePages: true, manageSpace: false },
  VIEWER: { read: true, write: false, managePages: false, manageSpace: false },
};

export function can(role: SpaceRole | null | undefined, action: Action) {
  if (!role) return false;
  return MATRIX[role][action];
}

/**
 * Darf `actor` die Rolle eines Mitglieds von `current` auf `next` setzen?
 *
 * `manageSpace` haben OWNER und ADMIN gleichermassen — OWNER selbst ist
 * aber bewusst mehr: nur OWNER darf den Space loeschen (settings/actions)
 * und Einladungen koennen die Rolle gar nicht vergeben (invitations.ts).
 * Duerfte ein ADMIN OWNER verteilen, waere das in einem Klick umgangen:
 * sich selbst zum OWNER machen, den bisherigen OWNER degradieren, Space
 * loeschen. Deshalb ist OWNER hier fuer ADMIN weder vergebbar noch
 * entziehbar.
 */
export function canAssignRole(
  actor: SpaceRole | null | undefined,
  current: SpaceRole,
  next: SpaceRole,
): boolean {
  if (!can(actor, "manageSpace")) return false;
  if (actor === "OWNER") return true;
  return current !== "OWNER" && next !== "OWNER";
}

/** Darf `actor` ein Mitglied mit der Rolle `target` entfernen? */
export function canRemoveMember(
  actor: SpaceRole | null | undefined,
  target: SpaceRole,
): boolean {
  if (!can(actor, "manageSpace")) return false;
  return actor === "OWNER" || target !== "OWNER";
}
