import {
  isAtLeast,
  strongestSpaceRole,
  type SpaceRole,
} from "@dokunc/db";

export type Action =
  | "read"
  | "comment"
  | "write"
  | "managePages"
  | "manageSpace";

/**
 * Kommentieren hängt bewusst nicht am Schreibrecht: wer eine Seite
 * lesen darf, darf sie auch besprechen. Ohne das konnte eine VIEWER-Rolle
 * eine Fehlinformation sehen, aber nicht darauf hinweisen.
 */
const MATRIX: Record<SpaceRole, Record<Action, boolean>> = {
  OWNER: {
    read: true,
    comment: true,
    write: true,
    managePages: true,
    manageSpace: true,
  },
  ADMIN: {
    read: true,
    comment: true,
    write: true,
    managePages: true,
    manageSpace: true,
  },
  MEMBER: {
    read: true,
    comment: true,
    write: true,
    managePages: true,
    manageSpace: false,
  },
  VIEWER: {
    read: true,
    comment: true,
    write: false,
    managePages: false,
    manageSpace: false,
  },
};

export function can(role: SpaceRole | null | undefined, action: Action) {
  if (!role) return false;
  return MATRIX[role][action];
}

/**
 * Wer welche Rolle vergeben oder entziehen darf, steht in
 * `lib/role-policy.ts` (canChangeRole, canRemoveMember). Dort — und nur
 * dort — liegt auch die schärfere Regel, dass sich die eigene Rolle
 * nicht ändern lässt. Eine zweite Fassung hier wäre die schwächere und
 * damit die Lücke.
 */

/**
 * Rangfolge der Rollen.
 *
 * Gebraucht, seit eine Person ihre Rolle aus mehreren Quellen bekommen
 * kann: aus der eigenen Mitgliedschaft und aus jeder Gruppe, die dem
 * Space zugeordnet ist. Es gilt die stärkste — eine Gruppe soll nie
 * wegnehmen, was jemand schon hat.
 *
 * Die Regel selbst liegt in `@dokunc/db`, weil der Collab-Server
 * dieselbe Antwort geben muss; hier steht nur der Zugang dazu.
 */
export const strongestRole = strongestSpaceRole;
export const atLeast = isAtLeast;

/**
 * Rollen, die einer Gruppe zugewiesen werden dürfen.
 *
 * Ohne OWNER: Eigentümerschaft bleibt persönlich. Sonst hinge die
 * Regel „der letzte Eigentümer bleibt" an einer Gruppenmitgliedschaft,
 * die jemand anderes jederzeit leeren kann.
 */
export const GROUP_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

export function isGroupRole(value: unknown): value is SpaceRole {
  return (GROUP_ROLES as readonly string[]).includes(String(value));
}
