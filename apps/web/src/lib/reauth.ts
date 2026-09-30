import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@dokunc/db";
import { audit } from "./audit";
import { attempt, resetLimit } from "./rate-limit";
import { RATE_LIMITS } from "./rate-limits";
import { destroySession, sessionMaxAgeSeconds } from "./session";

/**
 * Bestaetigung mit dem aktuellen Passwort, fuer alle Stellen, die es
 * verlangen: Passwort aendern, Konto loeschen, Zwei-Faktor abschalten,
 * neue Wiederherstellungscodes.
 *
 * Vorher prueften die ersten beiden ohne jede Bremse und die beiden
 * TOTP-Aktionen je mit eigenem Zaehler, und kein Fehlversuch stand im
 * Audit. Aus einer kurz unbeaufsichtigten Sitzung liess sich das Passwort
 * so beliebig oft raten, und mit ihm das Konto dauerhaft uebernehmen.
 *
 * Zwei Zaehler:
 *  - je Konto (`reauth:<konto>`, RATE_LIMITS.reauth): alle vier Stellen
 *    und alle Sitzungen zusammen. Gezaehlt wird vor bcrypt, damit
 *    gleichzeitige Versuche nicht an der Bremse vorbeikommen.
 *  - je Sitzung, nur Fehlversuche (`reauth-sitzung:<sitzung>`): nach dem
 *    zehnten endet die Sitzung. Kumuliert statt im Fenster der
 *    Kontobremse: wer sorgfaeltig raet, bliebe sonst bei neun je zehn
 *    Minuten und kaeme ueber eine lange Sitzung auf Tausende Versuche.
 *    Ein Ende beim Ueberlaufen der Kontobremse traefe zudem die Sitzung,
 *    die als naechste bestaetigt, womoeglich die rechtmaessige.
 *
 * Ein Erfolg raeumt beide Zaehler: nur wer das Passwort kennt, kann das,
 * und niemand sperrt sich so ueber mehrere Geraete aus.
 */

/** Wofuer das Passwort bestaetigt wird; steht im Audit (metadata.operation). */
export type ReauthZweck = "password_change" | "account_delete" | "totp_disable" | "recovery_codes";

export type ReauthErgebnis =
  | { ok: true }
  | { ok: false; grund: "falsch" | "gebremst" | "sitzung_beendet"; meldung: string };

export const REAUTH_GEBREMST = "Zu viele Versuche. Bitte in 10 Minuten erneut.";
export const REAUTH_SITZUNG_BEENDET =
  "Zu viele falsche Passwörter. Diese Anmeldung wurde aus Sicherheitsgründen beendet; bitte neu anmelden.";

/** Fehlversuche je Sitzung, nach denen sie endet. */
const FEHLVERSUCHE_JE_SITZUNG = 10;

/**
 * Fenster des Sitzungszaehlers: mindestens 30 Tage und nie kuerzer als
 * eine Sitzung lebt (JWT_EXPIRES_IN). Sonst gaebe es in einer langen
 * Sitzung nach Ablauf des Fensters zehn neue Versuche.
 */
function sitzungsFenster(): number {
  return Math.max(30 * 24 * 3600, sessionMaxAgeSeconds());
}

export async function verifyCurrentPassword(
  person: { id: string; sessionId: string },
  password: string,
  zweck: ReauthZweck,
  optionen: { falsch?: string } = {},
): Promise<ReauthErgebnis> {
  // requireUser liefert die Kennung immer. Fehlt sie, teilten sich alle
  // solchen Aufrufe einen Zaehler "reauth-sitzung:undefined"; lieber laut.
  if (!person.sessionId) throw new Error("verifyCurrentPassword: Sitzung fehlt");

  const kontoSchluessel = `reauth:${person.id}`;
  const versuch = await attempt(kontoSchluessel, RATE_LIMITS.reauth);
  if (!versuch.allowed) {
    // Nur der erste abgewiesene Versuch im Fenster kommt ins Audit: ein
    // abgewiesener kostet nichts, das Log liesse sich sonst fluten.
    if (versuch.firstRejection) {
      await audit({
        action: "auth.reauth_failed",
        actorId: person.id,
        metadata: { operation: zweck, reason: "throttled" },
      });
    }
    return { ok: false, grund: "gebremst", meldung: REAUTH_GEBREMST };
  }

  const row = await prisma.user.findUnique({
    where: { id: person.id },
    select: { passwordHash: true },
  });
  if (row && (await bcrypt.compare(password, row.passwordHash))) {
    await resetLimit(kontoSchluessel);
    await resetLimit(`reauth-sitzung:${person.sessionId}`);
    return { ok: true };
  }

  const fehlversuch = await attempt(`reauth-sitzung:${person.sessionId}`, {
    versuche: FEHLVERSUCHE_JE_SITZUNG,
    fenster: sitzungsFenster(),
  });
  if (fehlversuch.count >= FEHLVERSUCHE_JE_SITZUNG) {
    await prisma.session.updateMany({
      where: { id: person.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await destroySession();
    await audit({
      action: "auth.reauth_failed",
      actorId: person.id,
      metadata: { operation: zweck, reason: "bad_password", sessionEnded: true },
    });
    return { ok: false, grund: "sitzung_beendet", meldung: REAUTH_SITZUNG_BEENDET };
  }
  await audit({
    action: "auth.reauth_failed",
    actorId: person.id,
    metadata: { operation: zweck, reason: "bad_password" },
  });
  return { ok: false, grund: "falsch", meldung: optionen.falsch ?? "Passwort ist falsch." };
}
