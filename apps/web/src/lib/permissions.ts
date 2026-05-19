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
