import "server-only";
import { prisma } from "@dokunc/db";
import { hashToken, safeEqualHex } from "./invitations";
import { generateRecoveryCodes, normalizeRecoveryCode } from "./totp";

/**
 * Die Datenbankseite des zweiten Faktors.
 *
 * Bewusst eigene Datei und nicht in den Server-Actions: beide Hälften
 * (Anmeldung und Kontoverwaltung) brauchen dieselben Regeln, und die
 * Einmaligkeit von Code und Zeitschritt steckt in Abfragebedingungen —
 * die lassen sich nur gegen eine echte Datenbank prüfen.
 */

/** Voreinstellung: zehn Codes, wie bei den meisten Diensten. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Hält den benutzten TOTP-Zeitschritt fest und meldet, ob er neu war.
 *
 * Die Bedingung steht im Update selbst: geschrieben wird nur, wenn der
 * Schritt weiter ist als der zuletzt vermerkte. Damit gewinnt bei zwei
 * gleichzeitigen Anmeldungen mit demselben Code genau eine — und ein
 * abgelesener Code öffnet innerhalb seines Fensters kein zweites Mal
 * (RFC 6238, Abschnitt 5.2).
 */
export async function claimTotpStep(
  userId: string,
  step: number,
): Promise<boolean> {
  const { count } = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
    },
    data: { totpLastStep: step },
  });
  return count > 0;
}

/**
 * Wiederherstellungscode einlösen.
 *
 * Jeder Code gilt genau einmal; verglichen wird über den Hash, im
 * Klartext liegt nichts. `usedAt` steht auch in der Bedingung des
 * Updates, damit zwei gleichzeitige Versuche denselben Code nicht
 * zweimal verbrauchen.
 */
export async function consumeRecoveryCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const hash = hashToken(normalizeRecoveryCode(code));
  const rows = await prisma.totpRecoveryCode.findMany({
    where: { userId, usedAt: null },
    select: { id: true, codeHash: true },
  });
  const match = rows.find((row) => safeEqualHex(row.codeHash, hash));
  if (!match) return false;

  const { count } = await prisma.totpRecoveryCode.updateMany({
    where: { id: match.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count > 0;
}

/**
 * Ersetzt den Satz Wiederherstellungscodes und gibt den Klartext genau
 * einmal zurück. In der Datenbank steht nur der Hash — wer sie verliert,
 * lässt neue erzeugen.
 */
export async function issueRecoveryCodes(
  userId: string,
  count = RECOVERY_CODE_COUNT,
): Promise<string[]> {
  const codes = generateRecoveryCodes(count);
  await prisma.totpRecoveryCode.deleteMany({ where: { userId } });
  await prisma.totpRecoveryCode.createMany({
    data: codes.map((code) => ({
      userId,
      codeHash: hashToken(normalizeRecoveryCode(code)),
    })),
    skipDuplicates: true,
  });
  return codes;
}
