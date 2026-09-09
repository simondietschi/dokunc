import type { SpaceRole } from "@dokunc/db";

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
