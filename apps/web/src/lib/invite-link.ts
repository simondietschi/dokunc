import "server-only";
import type { EnvWarn } from "@dokunc/editor";
import { log } from "@/lib/log";

/**
 * Wer bekommt den Einladungslink zur Weitergabe von Hand, wenn keine Mail
 * hinausging (kein SMTP, oder der Versand scheiterte ohne gueltige fruehere
 * Einladung)? Wer den Link hat, kann mit der eingeladenen Adresse ein Konto
 * anlegen. Jede angemeldete Person darf einen Space anlegen und ist dort
 * OWNER; deshalb per Vorgabe nur Admin-Personen der Instanz.
 *   admins    nur user.isAdmin (Vorgabe)
 *   managers  alle mit manageSpace
 */
export type InviteLinkMode = "admins" | "managers";
export const DEFAULT_INVITE_LINK_MODE: InviteLinkMode = "admins";

const VARIABLE = "INVITE_LINK_WITHOUT_MAIL";
const UNGUELTIG = "Ungueltiger Wert, Vorgabe gilt";

/** Getrimmt, gross/klein egal; leer still Vorgabe, sonst Vorgabe mit Warnung. */
export function readInviteLinkMode(
  env: Record<string, string | undefined>,
  warn: EnvWarn,
): InviteLinkMode {
  const raw = env[VARIABLE]?.trim() ?? "";
  if (raw === "") return DEFAULT_INVITE_LINK_MODE;
  const lower = raw.toLowerCase();
  if (lower === "admins" || lower === "managers") return lower;
  warn({ variable: VARIABLE, wert: raw.slice(0, 40) }, UNGUELTIG);
  return DEFAULT_INVITE_LINK_MODE;
}

let gewarnt = false;

/** Aus process.env; ein ungueltiger Wert wird einmal je Prozess gewarnt. */
export function inviteLinkMode(): InviteLinkMode {
  // Kein Zwischenspeichern des Werts: jede Anfrage liest die Umgebung neu
  // (billig), nur die Warnung erscheint hoechstens einmal.
  return readInviteLinkMode(process.env, (detail, msg) => {
    if (gewarnt) return;
    gewarnt = true;
    log.warn(detail, msg);
  });
}

export function mayReceiveInviteLink(
  user: { isAdmin: boolean },
  mode: InviteLinkMode,
): boolean {
  return mode === "managers" || user.isAdmin;
}
