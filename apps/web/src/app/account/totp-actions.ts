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
import { issueRecoveryCodes } from "@/lib/totp-store";

/**
 * Einrichtung und Abschaltung des zweiten Faktors.
 *
 * Der Ablauf hat bewusst zwei Schritte: `startTotpSetupAction` legt das
 * Geheimnis an, aber `totpEnabledAt` bleibt leer. Erst ein gültiger Code
 * schaltet scharf. Wer die App zwischendurch schliesst, sperrt sich so
 * nicht aus einem Konto aus, dessen Code er nie gesehen hat.
 */
export type TotpState =
  | {
      error?: string;
      success?: string;
      setup?: { grouped: string; uri: string; qr: string | null };
      recoveryCodes?: string[];
    }
  | undefined;

const CONFIRM_ATTEMPTS = 10;
const CONFIRM_WINDOW_SEC = 600;

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
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: seal(secret), totpEnabledAt: null, totpLastStep: null },
  });

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
  if (!(await rateLimit(brakeKey, CONFIRM_ATTEMPTS, CONFIRM_WINDOW_SEC))) {
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
  const codes = await issueRecoveryCodes(user.id);
  await prisma.user.update({
    where: { id: user.id },
    // Der Zeitschritt wird gleich mit vermerkt: derselbe Code soll nicht
    // direkt danach auch noch die erste Anmeldung öffnen.
    data: { totpEnabledAt: new Date(), totpLastStep: step },
  });
  await audit({ action: "auth.totp_enabled", actorId: user.id });
  revalidatePath("/account");
  return {
    success: "Zwei-Faktor ist aktiv.",
    recoveryCodes: codes,
  };
}

/** Angefangene, nie bestätigte Einrichtung wieder wegräumen. */
export async function cancelTotpSetupAction(): Promise<void> {
  const user = await requireUser();
  await prisma.user.updateMany({
    // totpEnabledAt in der Bedingung: eine scharfe Einrichtung darf
    // dieser Weg nie abschalten.
    where: { id: user.id, totpEnabledAt: null },
    data: { totpSecret: null },
  });
  revalidatePath("/account");
}

export async function disableTotpAction(
  _prev: TotpState,
  form: FormData,
): Promise<TotpState> {
  const user = await requireUser();
  const password = str(form, "password");
  if (!password) return { error: "Passwort fehlt." };

  const brakeKey = `totp:disable:${user.id}`;
  if (!(await rateLimit(brakeKey, CONFIRM_ATTEMPTS, CONFIRM_WINDOW_SEC))) {
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
 * Neue Wiederherstellungscodes. Die alten verfallen dabei — sonst
 * gäbe es nach einem verlorenen Zettel zwei gültige Sätze.
 */
export async function regenerateRecoveryCodesAction(
  _prev: TotpState,
  form: FormData,
): Promise<TotpState> {
  const user = await requireUser();
  const password = str(form, "password");
  if (!password) return { error: "Passwort fehlt." };

  const brakeKey = `totp:recovery:${user.id}`;
  if (!(await rateLimit(brakeKey, CONFIRM_ATTEMPTS, CONFIRM_WINDOW_SEC))) {
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
  const codes = await issueRecoveryCodes(user.id);
  await audit({ action: "auth.recovery_codes_renewed", actorId: user.id });
  revalidatePath("/account");
  return {
    success: "Neue Codes erzeugt. Die alten gelten nicht mehr.",
    recoveryCodes: codes,
  };
}
