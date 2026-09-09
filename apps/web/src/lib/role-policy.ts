import type { SpaceRole } from "@dokunc/db";
import { can } from "./permissions";

/**
 * Regeln für Rollenvergabe und Mitgliederentfernung.
 *
 * Rein und ohne Datenbank, damit dieselbe Entscheidung im Server und in
 * der Oberfläche gilt: die Mitgliederseite bietet nur an, was die Action
 * auch durchlässt. Und weil sie rein ist, ist sie testbar.
 *
 * Kern der Härtung: `manageSpace` hat auch ADMIN. Vorher genügte das,
 * um sich selbst zum OWNER zu machen — die höchste Rolle war damit
 * einen Klick entfernt.
 */
export type PolicyResult = { allowed: true } | { allowed: false; reason: string };

const OK: PolicyResult = { allowed: true };
const deny = (reason: string): PolicyResult => ({ allowed: false, reason });

export const SPACE_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

export function isSpaceRole(v: unknown): v is SpaceRole {
  return typeof v === "string" && (SPACE_ROLES as readonly string[]).includes(v);
}

/** Rollen, die diese Person überhaupt vergeben darf. */
export function assignableRoles(actorRole: SpaceRole): SpaceRole[] {
  return actorRole === "OWNER"
    ? [...SPACE_ROLES]
    : SPACE_ROLES.filter((r) => r !== "OWNER");
}

export function canChangeRole(input: {
  actorRole: SpaceRole;
  /** Handelt es sich um die eigene Mitgliedschaft? */
  isSelf: boolean;
  currentRole: SpaceRole;
  nextRole: SpaceRole;
  /** Anzahl OWNER im Space (für den Schutz des letzten). */
  ownerCount: number;
}): PolicyResult {
  if (!can(input.actorRole, "manageSpace")) {
    return deny("Keine Berechtigung, Rollen zu ändern.");
  }
  // Ohne diese Zeile kann sich jeder ADMIN selbst zum OWNER machen.
  if (input.isSelf) return deny("Die eigene Rolle lässt sich nicht ändern.");
  if (input.currentRole === input.nextRole) return OK;
  if (
    (input.nextRole === "OWNER" || input.currentRole === "OWNER") &&
    input.actorRole !== "OWNER"
  ) {
    return deny("Nur Eigentümer können die Rolle OWNER vergeben oder entziehen.");
  }
  if (input.currentRole === "OWNER" && input.ownerCount <= 1) {
    return deny("Der letzte Eigentümer kann nicht herabgestuft werden.");
  }
  return OK;
}

export function canRemoveMember(input: {
  actorRole: SpaceRole;
  isSelf: boolean;
  targetRole: SpaceRole;
  ownerCount: number;
}): PolicyResult {
  if (!can(input.actorRole, "manageSpace")) {
    return deny("Keine Berechtigung, Mitglieder zu entfernen.");
  }
  if (input.isSelf) {
    return deny("Die eigene Mitgliedschaft lässt sich hier nicht entfernen.");
  }
  if (input.targetRole === "OWNER" && input.actorRole !== "OWNER") {
    return deny("Nur Eigentümer können Eigentümer entfernen.");
  }
  if (input.targetRole === "OWNER" && input.ownerCount <= 1) {
    return deny("Der letzte Eigentümer kann nicht entfernt werden.");
  }
  return OK;
}
