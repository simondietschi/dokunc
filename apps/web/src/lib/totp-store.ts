import "server-only";
import { prisma, type Prisma } from "@dokunc/db";
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
 * So lange wartet ein neu ausgegebener Satz auf seine Bestaetigung.
 *
 * Lang genug, um die Codes in einen Passwortmanager zu legen oder
 * auszudrucken; kurz genug, dass ein nie bestaetigter Satz nicht
 * tagelang als Kandidat herumliegt. Danach hilft nur ein neuer Satz —
 * die bisherigen Codes gelten bis dahin ohnehin weiter.
 */
export const RECOVERY_CODE_CONFIRM_MS = 30 * 60 * 1000;

type Db = Prisma.TransactionClient;

/**
 * Nur bestaetigte Codes loesen etwas ein. `pendingUntil` NULL heisst
 * aktiv (siehe schema.prisma), damit bleiben auch die Codes gueltig,
 * die vor der Spalte entstanden sind.
 */
const ACTIVE = {
  usedAt: null,
  pendingUntil: null,
} satisfies Prisma.TotpRecoveryCodeWhereInput;

/** Ausgegeben, aber noch nicht bestaetigt — abgelaufen oder nicht. */
const PENDING = {
  pendingUntil: { not: null },
} satisfies Prisma.TotpRecoveryCodeWhereInput;

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
 * zweimal verbrauchen. Ein noch nicht bestaetigter Code zaehlt nicht:
 * sonst gaelte ein Satz, dessen Klartext die Person vielleicht nie
 * erreicht hat, und wer die Antwort abfaengt, haette einen zweiten
 * Faktor in der Hand.
 */
export async function consumeRecoveryCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const hash = hashToken(normalizeRecoveryCode(code));
  const rows = await prisma.totpRecoveryCode.findMany({
    where: { userId, ...ACTIVE },
    select: { id: true, codeHash: true },
  });
  const match = rows.find((row) => safeEqualHex(row.codeHash, hash));
  if (!match) return false;

  const { count } = await prisma.totpRecoveryCode.updateMany({
    where: { id: match.id, ...ACTIVE },
    data: { usedAt: new Date() },
  });
  return count > 0;
}

/**
 * Zahl der Codes, die jetzt eine Anmeldung retten koennen. Ein
 * ausstehender Satz zaehlt nicht mit: die Anzeige im Konto soll sagen,
 * was im Notfall wirklich hilft.
 */
export async function countActiveRecoveryCodes(
  userId: string,
): Promise<number> {
  return prisma.totpRecoveryCode.count({ where: { userId, ...ACTIVE } });
}

/**
 * Gibt einen neuen Satz Wiederherstellungscodes aus und liefert den
 * Klartext genau einmal zurück. In der Datenbank steht nur der Hash.
 *
 * Der Satz entsteht AUSSTEHEND: er loest nichts ein, und die bisherigen
 * Codes bleiben gueltig, bis die Person einen der neuen Codes mit
 * `confirmRecoveryCodes` eintippt. Frueher ersetzte der neue Satz den
 * alten sofort; kam die Antwort mit dem Klartext nicht an (Verbindung
 * weg, Tab geschlossen), hatte das Konto den zweiten Faktor aktiv und
 * keinen brauchbaren Wiederherstellungscode mehr.
 *
 * Ein noch ausstehender Satz wird dabei ersetzt, abgelaufene Reste
 * gleich mit. Loeschen und Neuanlegen stehen in einer Transaktion; mit
 * `tx` laeuft beides in der des Aufrufers, der so eigene Bedingungen
 * davorsetzen kann (siehe `confirmTotpAction`).
 */
export async function issueRecoveryCodes(
  userId: string,
  count = RECOVERY_CODE_COUNT,
  tx?: Db,
): Promise<string[]> {
  const codes = generateRecoveryCodes(count);
  // EIN Zeitstempel fuer den ganzen Satz: er ist Frist und Kennung
  // zugleich. `confirmRecoveryCodes` schaltet genau die Zeilen scharf,
  // die denselben Wert tragen wie der eingetippte Code.
  const pendingUntil = new Date(Date.now() + RECOVERY_CODE_CONFIRM_MS);
  const write = async (db: Db) => {
    await db.totpRecoveryCode.deleteMany({ where: { userId, ...PENDING } });
    await db.totpRecoveryCode.createMany({
      data: codes.map((code) => ({
        userId,
        codeHash: hashToken(normalizeRecoveryCode(code)),
        pendingUntil,
      })),
      skipDuplicates: true,
    });
  };
  if (tx) await write(tx);
  else await prisma.$transaction(write);
  return codes;
}

/** Einen nie bestaetigten Satz verwerfen; aktive Codes bleiben. */
export async function discardPendingRecoveryCodes(
  userId: string,
  db: Db = prisma,
): Promise<void> {
  await db.totpRecoveryCode.deleteMany({ where: { userId, ...PENDING } });
}

/**
 * Ausgang einer Bestaetigung:
 * - `enabled`: Einrichtung abgeschlossen, der zweite Faktor gilt ab jetzt.
 * - `renewed`: der neue Satz hat den alten abgeloest.
 * - `already`: kein Satz wartet mehr, und der Code gehoert zu den schon
 *   aktiven. Typisch nach einer verlorenen Antwort: die Bestaetigung ist
 *   durch, die Person schickt denselben Code noch einmal. Nichts geaendert.
 * - `none`: kein Satz wartet mehr, und aktiv ist der Code auch nicht. Die
 *   Liste der Person wurde verworfen (Verwerfen, Abbruch oder Neubeginn
 *   der Einrichtung), oder sie hat sich bei einer schon bestaetigten Liste
 *   vertippt. Nichts geaendert.
 * - `wrong`: ein Satz wartet, aber der Code gehoert nicht dazu. Vertippt,
 *   ein alter Code, oder die Liste der Person wurde durch einen neueren
 *   Satz ersetzt — welcher Fall, laesst sich hier nicht unterscheiden,
 *   denn ein ersetzter Satz ist geloescht. Nichts geaendert.
 * - `expired`: der Code passt, aber die Frist ist vorbei. Nichts geaendert.
 * - `stale`: Wettlauf. Beim Nachschlagen wartete der Satz noch, bis zum
 *   Umschalten hat ihn aber ein anderer Weg bestaetigt, ersetzt oder
 *   verworfen; oder die Einrichtung wurde in dieser Luecke abgeschaltet
 *   bzw. neu begonnen. Nichts geaendert.
 */
export type RecoveryConfirmResult =
  | "enabled"
  | "renewed"
  | "already"
  | "none"
  | "wrong"
  | "expired"
  | "stale";

/** Bricht die Transaktion ab, ohne dass ein echter Fehler vorliegt. */
class SetGone extends Error {}

/** Was `confirmRecoveryCodes` unter der Sperre von der Nutzerzeile liest. */
type LockedUser = {
  totpEnabledAt: Date | null;
  totpSecret: string | null;
  totpLastStep: number | null;
};

/**
 * Bestaetigt einen ausstehenden Satz mit einem seiner Codes.
 *
 * Das Eintippen beweist, dass die Codes die Person erreicht haben. Erst
 * dann, und in EINER Transaktion, fallen die bisherigen Codes weg und
 * der neue Satz wird aktiv. Scheitert irgendetwas dazwischen, bleibt
 * alles beim Alten — es gibt keinen Moment, in dem keiner der beiden
 * Saetze gilt.
 *
 * Bei der Ersteinrichtung schaltet dieselbe Transaktion auch den
 * zweiten Faktor scharf (`totpEnabledAt`): ein Konto mit aktivem
 * zweiten Faktor und ohne bestaetigte Codes kann so nicht entstehen.
 * Vorausgesetzt ist, dass der TOTP-Code zum gespeicherten Geheimnis
 * schon geprueft wurde; `confirmTotpAction` vermerkt dabei den
 * Zeitschritt, und `startTotpSetupAction` setzt ihn fuer jedes neue
 * Geheimnis zurueck.
 *
 * Der eingetippte Code bleibt gueltig. Er hat den Browser der Person
 * nicht anders verlassen als bei einer Anmeldung, und verbraucht stuende
 * die Person direkt nach dem Speichern mit einem Code weniger da, als
 * sie eben abgelegt hat.
 */
export async function confirmRecoveryCodes(
  userId: string,
  code: string,
): Promise<RecoveryConfirmResult> {
  const hash = hashToken(normalizeRecoveryCode(code));
  const rows = await prisma.totpRecoveryCode.findMany({
    where: { userId, usedAt: null, ...PENDING },
    select: { codeHash: true, pendingUntil: true },
  });
  const match = rows.find((row) => safeEqualHex(row.codeHash, hash));
  if (!match?.pendingUntil) {
    // Wartet noch ein Satz, bleibt es bei `wrong`, auch wenn der Code
    // aktiv ist: dann ist er fast immer ein alter Code vom Zettel statt
    // einer aus der neuen Liste, und "gilt bereits" hiesse, die neue
    // Liste sei bestaetigt.
    if (rows.length > 0) return "wrong";
    return (await isActiveRecoveryCode(userId, hash)) ? "already" : "none";
  }
  const set = match.pendingUntil;
  const now = new Date();
  if (set.getTime() <= now.getTime()) return "expired";

  try {
    return await prisma.$transaction(async (tx) => {
      // Zuerst die Nutzerzeile sperren und unter der Sperre lesen, erst
      // danach die Codes anfassen. In dieser Reihenfolge gehen auch
      // startTotpSetupAction, cancelTotpSetupAction und confirmTotpAction
      // vor (erst tx.user.updateMany, dann die Codes). Andersherum hielte
      // jede Seite die Zeilen, auf die die andere wartet, und Postgres
      // braeche eine davon mit "deadlock detected" ab — die andere Seite
      // stuende mit einem Fehler statt einer Meldung da.
      //
      // FOR NO KEY UPDATE ist dieselbe Sperre, die jedes dieser Updates
      // nimmt (keine der TOTP-Spalten steckt in einem eindeutigen Index);
      // diese Wege warten also aufeinander. FOR UPDATE waere zu stark: es
      // blockiert auch FOR KEY SHARE, und diese Sperre nimmt Postgres beim
      // Einfuegen neuer Codes, um den Fremdschluessel auf die Nutzerzeile
      // zu pruefen. issueRecoveryCodes ohne `tx` (neue Codes aus
      // regenerateRecoveryCodesAction) geht in der umgekehrten Reihenfolge
      // vor: es loescht erst den wartenden Satz und fuegt dann ein, fasst
      // also zuerst die Codezeilen an und die Nutzerzeile erst danach. Mit
      // FOR UPDATE hielte es dabei genau die Zeilen, auf die das Update
      // unten wartet, und wartete selbst auf unsere Sperre. FOR NO KEY
      // UPDATE laesst die Pruefung durch; das Update unten findet den
      // geloeschten Satz danach nicht mehr (`stale`).
      // discardRecoveryCodesAction fasst die Nutzerzeile gar nicht an.
      const [user] = await tx.$queryRaw<LockedUser[]>`
        SELECT "totpEnabledAt", "totpSecret", "totpLastStep"
        FROM "User" WHERE id = ${userId}
        FOR NO KEY UPDATE
      `;
      if (!user) throw new SetGone();

      await tx.totpRecoveryCode.deleteMany({
        where: { userId, pendingUntil: null },
      });
      // Die Zeilen des Satzes stehen in der Bedingung und nicht aus der
      // Abfrage oben: hat ein neuer Satz diesen inzwischen ersetzt,
      // trifft das Update nichts, und die Transaktion rollt auch das
      // Loeschen der alten Codes zurueck.
      const { count } = await tx.totpRecoveryCode.updateMany({
        where: { userId, pendingUntil: set },
        data: { pendingUntil: null },
      });
      if (count === 0) throw new SetGone();

      if (user.totpEnabledAt) return "renewed";

      // Ersteinrichtung. Fehlt unter der Sperre das Geheimnis oder der
      // vermerkte Zeitschritt, wurde die Einrichtung abgeschaltet oder
      // neu begonnen (neues, noch ungeprueftes Geheimnis): dann darf
      // dieser Satz den Faktor nicht scharf schalten. Die Bedingung im
      // Update wiederholt das; solange die Sperre gilt, aendert sich die
      // Zeile nicht, sie bleibt als zweite Absicherung stehen.
      if (!user.totpSecret || user.totpLastStep === null) throw new SetGone();
      const enabled = await tx.user.updateMany({
        where: {
          id: userId,
          totpEnabledAt: null,
          totpSecret: user.totpSecret,
          totpLastStep: { not: null },
        },
        data: { totpEnabledAt: now },
      });
      if (enabled.count === 0) throw new SetGone();
      return "enabled";
    });
  } catch (e) {
    if (e instanceof SetGone) return "stale";
    throw e;
  }
}

/**
 * Gehoert der Hash zu einem aktiven, unbenutzten Code? Nur fuer die
 * Meldung nach einer Bestaetigung, die nichts mehr zu bestaetigen fand;
 * eingeloest wird hier nichts.
 */
async function isActiveRecoveryCode(
  userId: string,
  hash: string,
): Promise<boolean> {
  const rows = await prisma.totpRecoveryCode.findMany({
    where: { userId, ...ACTIVE },
    select: { codeHash: true },
  });
  return rows.some((row) => safeEqualHex(row.codeHash, hash));
}
