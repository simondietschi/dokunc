import "server-only";
import { prisma } from "@dokunc/db";
import { requireUser } from "./current-user";

/**
 * Wann darf ein Konto verschwinden?
 *
 * Die Entscheidung selbst (`canDeleteUser`) bleibt rein und ohne
 * Datenbank, damit dieselbe Regel im Konto und im Admin-Bereich gilt und
 * sich testen lässt. Die Erhebung dazu (`orphanedSpacesFor`) steht
 * daneben: sie lag vorher in app/account/actions.ts, und diese Datei
 * trägt "use server" — dort wird JEDER Export zu einem aufrufbaren
 * Endpunkt, auch ein Helfer ohne Formular. Hier in lib/ ist sie schlicht
 * eine Funktion, die nur aufruft, wer sie importiert.
 */

/**
 * Der Grund als Kennung, nicht nur als Satz.
 *
 * Den Satz braucht die Konto-Seite, wo die Person ueber sich selbst
 * liest ("Du bist der letzte aktive Instanz-Admin"). Im Admin-Bereich
 * geht es um jemand anderen, und dort waere genau dieser Satz falsch —
 * deshalb entscheidet dort die Kennung ueber die Formulierung.
 */
export type DeletionReason = "letzter-admin" | "verwaiste-spaces";

export type DeletionCheck =
  | { allowed: true }
  | { allowed: false; code: DeletionReason; reason: string };

export function canDeleteUser(input: {
  /** Letzter aktiver Instanz-Admin? */
  isLastActiveAdmin: boolean;
  /** Spaces, in denen die Person der einzige Eigentümer ist. */
  orphanedSpaces: string[];
}): DeletionCheck {
  if (input.isLastActiveAdmin) {
    return {
      allowed: false,
      code: "letzter-admin",
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
      code: "verwaiste-spaces",
      reason: `Ohne dich stünde folgender Space ohne Eigentümer da: ${list}${more}. Übergib die Rolle zuerst.`,
    };
  }
  return { allowed: true };
}

/**
 * Spaces, in denen diese Person der einzige Eigentümer ist.
 * Gemeinsame Grundlage für Konto-Löschung im Konto und im Admin-Bereich.
 */
export async function orphanedSpacesFor(userId: string): Promise<string[]> {
  // Die Schranke bleibt, obwohl der Export kein Endpunkt mehr ist: die
  // Antwort verrät zu einer beliebigen userId, welche Spaces ihr allein
  // gehören — Space-Namen inklusive. Sie kostet wenig und hält fest,
  // dass diese Funktion nicht für fremde Konten gedacht ist.
  const me = await requireUser();
  if (me.id !== userId && !me.isAdmin) {
    throw new Error("Nicht berechtigt.");
  }

  const owned = await prisma.spaceMember.findMany({
    where: { userId, role: "OWNER" },
    select: { spaceId: true, space: { select: { name: true } } },
  });
  if (owned.length === 0) return [];

  // Nur aktive Konten zählen: ein deaktivierter Mit-Eigentümer kann den
  // Space nicht übernehmen, der Space wäre also trotzdem verwaist.
  const counts = await prisma.spaceMember.groupBy({
    by: ["spaceId"],
    where: {
      spaceId: { in: owned.map((o) => o.spaceId) },
      role: "OWNER",
      user: { isActive: true },
    },
    _count: { _all: true },
  });
  const single = new Set(
    counts.filter((c) => c._count._all <= 1).map((c) => c.spaceId),
  );
  return owned
    .filter((o) => single.has(o.spaceId))
    .map((o) => o.space.name);
}

/**
 * Dieselbe Ablehnung aus der Sicht einer Verwaltung.
 *
 * Ohne das blieb im Admin-Bereich nur ein Log-Eintrag: die Seite
 * kuendigte "endgültig löschen" an, und danach passierte wortlos nichts.
 * Die Space-Namen bleiben hier aussen vor — die Meldung reist als
 * Kennung in der Adresszeile, und dort gehoeren sie nicht hin.
 */
export function adminDeletionMessage(code: DeletionReason): string {
  return code === "letzter-admin"
    ? "Konto nicht gelöscht: Es ist der letzte aktive Instanz-Admin. Ernenne zuerst jemand anderen."
    : "Konto nicht gelöscht: Die Person ist alleinige Eigentümerin mindestens eines Space. Übergib die Rolle zuerst.";
}

/** Gehoert die Zeichenkette aus der Adresszeile zu einer bekannten Ablehnung? */
export function isDeletionReason(value: unknown): value is DeletionReason {
  return value === "letzter-admin" || value === "verwaiste-spaces";
}
