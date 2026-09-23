"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { str } from "@/lib/form";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { rateLimit, resetLimit } from "@/lib/rate-limit";
import { seal, unseal } from "@/lib/secret-box";
import { qrSvg } from "@/lib/qr";
import {
  generateTotpSecret,
  groupSecret,
  otpauthUri,
  verifyTotpStep,
} from "@/lib/totp";
import {
  RECOVERY_CODE_CONFIRM_MS,
  confirmRecoveryCodes,
  discardPendingRecoveryCodes,
  issueRecoveryCodes,
} from "@/lib/totp-store";
import { RATE_LIMITS } from "@/lib/rate-limits";

/**
 * Einrichtung und Abschaltung des zweiten Faktors.
 *
 * Der Ablauf hat bewusst drei Schritte: `startTotpSetupAction` legt das
 * Geheimnis an, aber `totpEnabledAt` bleibt leer. Ein gültiger Code aus
 * der App (`confirmTotpAction`) gibt die Wiederherstellungscodes aus,
 * und erst wenn die Person einen davon zurück eintippt
 * (`confirmRecoveryCodesAction`), schaltet der zweite Faktor scharf.
 * Wer die App zwischendurch schliesst, sperrt sich so nicht aus einem
 * Konto aus, dessen Code er nie gesehen hat — und wem die Antwort mit
 * den Codes verloren geht, der steht nicht mit aktivem zweitem Faktor
 * und ohne Weg zurück da.
 */
export type TotpState =
  | {
      error?: string;
      success?: string;
      setup?: { grouped: string; uri: string; qr: string | null };
      /**
       * Frisch ausgegebene, noch AUSSTEHENDE Codes. Sie gelten erst nach
       * `confirmRecoveryCodesAction`.
       */
      recoveryCodes?: string[];
      /** Frist für die Bestätigung in Minuten, für den Hinweis daneben. */
      confirmMinutes?: number;
      /**
       * Es wartet nichts mehr auf Bestätigung, die Liste kann weg: eben
       * bestätigt, oder die Bestätigung war schon durch (`already`).
       */
      confirmed?: boolean;
    }
  | undefined;

/** Frist als ganze Minuten für die Anzeige. */
const CONFIRM_MINUTES = Math.round(RECOVERY_CODE_CONFIRM_MS / 60_000);

/** Anzeigename der Instanz im Authenticator. */
function issuerName(): string {
  return process.env.APP_NAME?.trim() || "dokunc";
}

export async function startTotpSetupAction(
  _prev: TotpState,
  _form: FormData,
): Promise<TotpState> {
  const user = await requireUser();
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { totpEnabledAt: true },
  });
  if (row?.totpEnabledAt) {
    return { error: "Zwei-Faktor ist bereits aktiv." };
  }

  // Jeder Start erzeugt ein frisches Geheimnis: ein abgebrochener
  // Versuch soll nicht in einer fremden Authenticator-App weiterleben.
  const secret = generateTotpSecret();
  const started = await prisma.$transaction(async (tx) => {
    // `totpEnabledAt` steht in der Bedingung und nicht nur in der Abfrage
    // oben: schliesst ein anderer Tab die Einrichtung genau jetzt ab,
    // darf dieser Start das scharfe Geheimnis nicht überschreiben.
    // `totpLastStep` zurück auf null heisst: dieses Geheimnis ist noch
    // nicht geprüft (siehe `confirmRecoveryCodes`).
    const { count } = await tx.user.updateMany({
      where: { id: user.id, totpEnabledAt: null },
      data: { totpSecret: seal(secret), totpLastStep: null },
    });
    if (count === 0) return false;
    // Codes aus einem früheren Anlauf gehören zu einem anderen
    // Geheimnis. Blieben sie liegen, schaltete ihre Bestätigung dieses
    // neue scharf, bevor es je ein Code aus der App bestätigt hat.
    await discardPendingRecoveryCodes(user.id, tx);
    return true;
  });
  if (!started) return { error: "Zwei-Faktor ist bereits aktiv." };

  const uri = otpauthUri({
    secret,
    account: user.email,
    issuer: issuerName(),
  });
  return {
    setup: { grouped: groupSecret(secret), uri, qr: await qrSvg(uri) },
  };
}

export async function confirmTotpAction(
  _prev: TotpState,
  form: FormData,
): Promise<TotpState> {
  const user = await requireUser();
  const code = str(form, "code");
  if (!code) return { error: "Code fehlt." };

  const brakeKey = `totp:confirm:${user.id}`;
  if (
    !(await rateLimit(
      brakeKey,
      RATE_LIMITS.totpConfirm.versuche,
      RATE_LIMITS.totpConfirm.fenster,
    ))
  ) {
    return { error: "Zu viele Versuche. Bitte in 10 Minuten erneut." };
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { totpSecret: true, totpEnabledAt: true },
  });
  if (row?.totpEnabledAt) return { error: "Zwei-Faktor ist bereits aktiv." };
  // Kein Geheimnis in der Datenbank: die Einrichtung wurde nie begonnen
  // oder von `cancelTotpSetupAction` wieder weggeraeumt. Neu beginnen ist
  // hier wirklich der Weg.
  if (!row?.totpSecret) {
    return { error: "Die Einrichtung ist abgelaufen. Bitte neu beginnen." };
  }
  const secret = unseal(row.totpSecret);
  if (!secret) {
    /**
     * Das Geheimnis steht sehr wohl da — nur `unseal` kommt nicht daran:
     * APP_SECRET hat gewechselt oder der Wert ist beschaedigt. "Die
     * Einrichtung ist abgelaufen" schickte genau dann im Kreis, denn ein
     * neuer Anlauf legt ein Geheimnis an, das sich nach dem Neustart
     * ebenso wenig lesen laesst. Derselbe Fall wird in (auth)/actions.ts
     * `completeTotpLoginAction` schon unterschieden: eigener Text, laut
     * ins Log und ein Vermerk im Audit — ohne die beiden faellt ein
     * verlorener APP_SECRET im Betrieb nirgends auf.
     */
    log.error({ userId: user.id }, "totp secret unreadable");
    await audit({
      // Es gibt keine eigene Aktion fuer den gescheiterten Einrichtungs-
      // schritt; `during` haelt fest, dass es nicht die Anmeldung war.
      action: "auth.login_failed",
      actorId: user.id,
      metadata: { reason: "totp_secret_unreadable", during: "totp_setup" },
    });
    return {
      error:
        "Der zweite Faktor lässt sich zurzeit nicht prüfen. Ein neuer " +
        "Anlauf hilft nicht — wende dich an die Administration.",
    };
  }
  const step = verifyTotpStep(secret, code);
  if (step === null) {
    return {
      error:
        "Code stimmt nicht. Prüfe, ob die Uhr deines Geräts richtig geht.",
    };
  }

  await resetLimit(brakeKey);
  /**
   * Noch NICHT scharf schalten. Die Codes entstehen ausstehend, und erst
   * `confirmRecoveryCodesAction` setzt `totpEnabledAt` — in derselben
   * Transaktion, die die Codes aktiv schaltet. Stünde der Faktor schon
   * hier scharf, hätte das Konto ihn aktiv und keinen einzigen
   * brauchbaren Code, sobald diese Antwort die Person nicht erreicht.
   */
  const codes = await prisma.$transaction(async (tx) => {
    // Der Zeitschritt wird gleich mit vermerkt: derselbe Code soll nicht
    // direkt danach auch noch die erste Anmeldung öffnen. Zugleich ist er
    // der Beleg, dass GENAU dieses Geheimnis geprüft ist — deshalb steht
    // das Geheimnis in der Bedingung: hat ein anderer Tab inzwischen neu
    // begonnen, gehörten die Codes sonst zu einem ungeprüften Geheimnis.
    const { count } = await tx.user.updateMany({
      where: { id: user.id, totpEnabledAt: null, totpSecret: row.totpSecret },
      data: { totpLastStep: step },
    });
    if (count === 0) return null;
    return issueRecoveryCodes(user.id, undefined, tx);
  });
  if (!codes) {
    return {
      error:
        "Die Einrichtung wurde inzwischen neu begonnen oder abgebrochen. " +
        "Bitte neu beginnen.",
    };
  }
  return { recoveryCodes: codes, confirmMinutes: CONFIRM_MINUTES };
}

/**
 * Letzter Schritt nach dem Ausgeben neuer Wiederherstellungscodes: die
 * Person tippt einen davon ein. Das gilt für die Ersteinrichtung (dann
 * schaltet der zweite Faktor erst hier scharf) und für das Erneuern
 * (dann fallen erst hier die alten Codes weg).
 */
export async function confirmRecoveryCodesAction(
  _prev: TotpState,
  form: FormData,
): Promise<TotpState> {
  const user = await requireUser();
  const code = str(form, "code");
  if (!code) return { error: "Code fehlt." };

  const brakeKey = `totp:codes:${user.id}`;
  if (
    !(await rateLimit(
      brakeKey,
      RATE_LIMITS.totpConfirm.versuche,
      RATE_LIMITS.totpConfirm.fenster,
    ))
  ) {
    return { error: "Zu viele Versuche. Bitte in 10 Minuten erneut." };
  }

  const result = await confirmRecoveryCodes(user.id, code);
  if (result === "enabled" || result === "renewed") {
    await resetLimit(brakeKey);
    revalidatePath("/account");
    if (result === "enabled") {
      await audit({ action: "auth.totp_enabled", actorId: user.id });
      return { success: "Zwei-Faktor ist aktiv.", confirmed: true };
    }
    await audit({ action: "auth.recovery_codes_renewed", actorId: user.id });
    return {
      success: "Die neuen Codes gelten ab jetzt, die alten nicht mehr.",
      confirmed: true,
    };
  }
  if (result === "already") {
    // Meist ging die Antwort auf die erste Bestaetigung verloren, und die
    // Person schickt denselben Code noch einmal. Fuer sie ist die Sache
    // erledigt, deshalb `confirmed`: die Liste verschwindet wie nach
    // einer Bestaetigung. Die Bremse bleibt dagegen stehen — sonst liesse
    // sich mit EINEM bekannten Code der Zaehler immer wieder leeren und
    // beliebig oft pruefen, welche Codes noch gelten.
    revalidatePath("/account");
    return {
      success:
        "Dieser Code gilt bereits — es wartet nichts mehr auf Bestätigung.",
      confirmed: true,
    };
  }
  if (result === "wrong") {
    // Ein ersetzter Satz ist geloescht; ob die Person sich vertippt hat
    // oder ihre Liste inzwischen ersetzt wurde, weiss hier niemand. Die
    // Meldung nennt deshalb beide Wege.
    return {
      error:
        "Das ist keiner der Codes, die auf Bestätigung warten. Tippe einen " +
        "aus der Liste oben ab. Passt er trotzdem nicht, wurden inzwischen " +
        "in einem anderen Fenster neue Codes erzeugt, und diese Liste gilt " +
        "nicht mehr — lade dann die Seite neu.",
    };
  }
  if (result === "stale") {
    return {
      error:
        "Die Codes wurden eben in einem anderen Fenster geändert. Lade die " +
        "Seite neu, um den aktuellen Stand zu sehen.",
    };
  }

  // `expired` oder `none`. Der Ausweg hängt davon ab, was die Seite
  // gerade zeigt: beim Erneuern gelten die bisherigen Codes weiter, und
  // der Knopf neben der Liste heisst „Verwerfen“; bei der Einrichtung
  // gibt es keine Codes, auf die man sich verlassen könnte, und der Knopf
  // heisst „Abbrechen“. Die Meldungen nennen den Knopf, der weiterführt:
  // solange die Liste dasteht, ist der Knopf für neue Codes ausgeblendet.
  //
  // Welche Seite das ist, schickt das Formular in `mode` mit. Das Feld
  // wählt nur den Text und prüft nichts. Nach `totpEnabledAt` allein
  // nannte die Meldung gerade dann einen Knopf, den dieser Tab nicht hat,
  // wenn ein anderes Fenster den Faktor inzwischen eingerichtet oder
  // abgeschaltet hatte. Ohne gültigen Wert (etwa eine Seite, die noch vor
  // diesem Feld geladen wurde) gilt der Stand der Datenbank.
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { totpEnabledAt: true },
  });
  const active = !!row?.totpEnabledAt;
  const mode = str(form, "mode");
  const renewing =
    mode === "renew" ? true : mode === "setup" ? false : active;
  if (renewing !== active) {
    // Weder „Verwerfen“ noch „Abbrechen“ führen dann zum aktuellen
    // Stand, nur ein Neuladen der Seite.
    return {
      error:
        "Der zweite Faktor wurde inzwischen eingerichtet oder abgeschaltet " +
        "(etwa in einem anderen Fenster). Lade die Seite neu.",
    };
  }
  if (result === "expired") {
    return {
      error: renewing
        ? "Die Frist für diese Codes ist abgelaufen. Die bisherigen Codes " +
          "gelten weiter. Über „Verwerfen“ kommst du zurück und kannst bei " +
          "Bedarf neue erzeugen."
        : "Die Frist für diese Codes ist abgelaufen. Über „Abbrechen“ lässt " +
          "sich die Einrichtung neu beginnen.",
    };
  }
  return {
    error: renewing
      ? "Diese Liste wartet nicht mehr auf Bestätigung: sie wurde verworfen " +
        "oder schon bestätigt. Vertippt? Dann gib den Code noch einmal ein. " +
        "Sonst gelten die bisherigen Codes weiter — über „Verwerfen“ kannst " +
        "du bei Bedarf neue erzeugen."
      : "Diese Codes gelten nicht mehr: die Einrichtung wurde inzwischen " +
        "abgebrochen oder in einem anderen Fenster neu begonnen. Über " +
        "„Abbrechen“ lässt sich hier neu beginnen.",
  };
}

/** Angefangene, nie bestätigte Einrichtung wieder wegräumen. */
export async function cancelTotpSetupAction(): Promise<void> {
  const user = await requireUser();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      // totpEnabledAt in der Bedingung: eine scharfe Einrichtung darf
      // dieser Weg nie abschalten.
      where: { id: user.id, totpEnabledAt: null },
      data: { totpSecret: null, totpLastStep: null },
    });
    // Die schon ausgegebenen, nie bestätigten Codes gleich mit. Nur wenn
    // die Einrichtung wirklich noch offen war — bei aktivem Faktor
    // gehörte ein ausstehender Satz zum Erneuern in einem anderen Tab.
    if (count > 0) await discardPendingRecoveryCodes(user.id, tx);
  });
  revalidatePath("/account");
}

/**
 * Neu erzeugte, nie bestätigte Codes verwerfen. Die bisherigen gelten
 * ohnehin weiter; ohne diesen Weg lägen die verworfenen bis zum Ende
 * der Frist als bestätigbarer Satz herum.
 */
export async function discardRecoveryCodesAction(): Promise<void> {
  const user = await requireUser();
  await discardPendingRecoveryCodes(user.id);
}

export async function disableTotpAction(
  _prev: TotpState,
  form: FormData,
): Promise<TotpState> {
  const user = await requireUser();
  const password = str(form, "password");
  if (!password) return { error: "Passwort fehlt." };

  const brakeKey = `totp:disable:${user.id}`;
  if (
    !(await rateLimit(
      brakeKey,
      RATE_LIMITS.totpConfirm.versuche,
      RATE_LIMITS.totpConfirm.fenster,
    ))
  ) {
    return { error: "Zu viele Versuche. Bitte in 10 Minuten erneut." };
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!row || !(await bcrypt.compare(password, row.passwordHash))) {
    return { error: "Passwort ist falsch." };
  }

  await resetLimit(brakeKey);
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
  });
  await prisma.totpRecoveryCode.deleteMany({ where: { userId: user.id } });
  await audit({ action: "auth.totp_disabled", actorId: user.id });
  revalidatePath("/account");
  return { success: "Zwei-Faktor ist abgeschaltet." };
}

/**
 * Neue Wiederherstellungscodes. Die alten verfallen — aber erst, wenn
 * die Person einen der neuen bestätigt hat (`confirmRecoveryCodesAction`).
 * Dann allerdings sicher: sonst gäbe es nach einem verlorenen Zettel
 * zwei gültige Sätze.
 */
export async function regenerateRecoveryCodesAction(
  _prev: TotpState,
  form: FormData,
): Promise<TotpState> {
  const user = await requireUser();
  const password = str(form, "password");
  if (!password) return { error: "Passwort fehlt." };

  const brakeKey = `totp:recovery:${user.id}`;
  if (
    !(await rateLimit(
      brakeKey,
      RATE_LIMITS.totpConfirm.versuche,
      RATE_LIMITS.totpConfirm.fenster,
    ))
  ) {
    return { error: "Zu viele Versuche. Bitte in 10 Minuten erneut." };
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, totpEnabledAt: true },
  });
  if (!row?.totpEnabledAt) return { error: "Zwei-Faktor ist nicht aktiv." };
  if (!(await bcrypt.compare(password, row.passwordHash))) {
    return { error: "Passwort ist falsch." };
  }

  await resetLimit(brakeKey);
  // Ausstehend: bis zur Bestätigung gelten die alten Codes weiter. Das
  // Audit folgt deshalb erst dort, wo der Wechsel wirklich geschieht.
  const codes = await issueRecoveryCodes(user.id);
  return { recoveryCodes: codes, confirmMinutes: CONFIRM_MINUTES };
}
