/**
 * Wann darf ein Konto verschwinden?
 *
 * Rein und ohne Datenbank, damit dieselbe Regel im Konto und im
 * Admin-Bereich gilt und sich testen lässt.
 */
export type DeletionCheck =
  | { allowed: true }
  | { allowed: false; reason: string };

export function canDeleteUser(input: {
  /** Letzter aktiver Instanz-Admin? */
  isLastActiveAdmin: boolean;
  /** Spaces, in denen die Person der einzige Eigentümer ist. */
  orphanedSpaces: string[];
}): DeletionCheck {
  if (input.isLastActiveAdmin) {
    return {
      allowed: false,
      reason:
        "Du bist der letzte aktive Instanz-Admin. Ernenne zuerst jemand anderen.",
    };
  }
  if (input.orphanedSpaces.length > 0) {
    const list = input.orphanedSpaces.slice(0, 3).join(", ");
    const more =
      input.orphanedSpaces.length > 3
        ? ` und ${input.orphanedSpaces.length - 3} weitere`
        : "";
    return {
      allowed: false,
      reason: `Ohne dich stünde folgender Space ohne Eigentümer da: ${list}${more}. Übergib die Rolle zuerst.`,
    };
  }
  return { allowed: true };
}
