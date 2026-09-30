import { prisma } from "@dokunc/db";
import { audit } from "./audit";
import { retireSetupToken } from "./setup-token";

/**
 * Das erste Konto der Instanz, unter einer Sperre.
 *
 * Vorher liefen Zählen und Anlegen ohne Transaktion: zwei gleichzeitige
 * erste Registrierungen (oder Passwort und SSO zugleich) wurden beide
 * Instanz-Admin. Eine Advisory-Sperre statt SERIALIZABLE, nach dem
 * Muster aus lib/page-position: ohne Wiederholungsschleife für
 * Serialisierungsfehler, und alle Wege nehmen dieselbe Sperre.
 */

const SPERRE = "dokunc:ersteinrichtung";

/** Nimmt die Sperre bis zum Ende der Transaktion und sagt, ob noch kein Konto existiert. */
export async function sperreErsteinrichtung(
  tx: Pick<typeof prisma, "$executeRaw" | "user">,
): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${SPERRE}, 0))`;
  return (await tx.user.findFirst({ select: { id: true } })) === null;
}

export type ErstesKonto = {
  email: string;
  name: string;
  passwordHash: string;
  oidcIssuer?: string;
  oidcSubject?: string;
};

/**
 * Legt das erste Konto als Instanz-Admin an, oder gibt null zurück, wenn
 * schon eines existiert (jemand war schneller).
 *
 * `nachSperre` ist allein für den Test der Gleichzeitigkeit: eine Pause
 * zwischen Sperre und Anlegen, damit zwei Läufe sicher überlappen.
 */
export async function createFirstAdmin(
  data: ErstesKonto,
  meta: {
    via: "password" | "sso";
    tokenNoetig: boolean;
    verifiedBy?: string | null;
  },
  o: { nachSperre?: () => Promise<void> } = {},
): Promise<{ id: string; tokenVersion: number; totpEnabledAt: Date | null } | null> {
  const angelegt = await prisma.$transaction(async (tx) => {
    if (!(await sperreErsteinrichtung(tx))) return null;
    await o.nachSperre?.();
    return tx.user.create({
      data: { ...data, isAdmin: true },
      select: { id: true, tokenVersion: true, totpEnabledAt: true },
    });
  });
  if (!angelegt) return null;

  await audit({
    action: "auth.registered",
    actorId: angelegt.id,
    metadata: { via: meta.via, isAdmin: true },
  });
  await audit({
    action: "auth.first_admin_created",
    actorId: angelegt.id,
    metadata: {
      via: meta.via,
      setupToken: meta.tokenNoetig ? "required" : "not_required",
      verifiedBy: meta.verifiedBy ?? null,
    },
  });
  await retireSetupToken();
  return angelegt;
}
