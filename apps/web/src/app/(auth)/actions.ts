"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { createSession } from "@/lib/session";
import { safeNext } from "@/lib/safe-redirect";
import { decideRegistration } from "@/lib/registration";
import {
  normalizeEmail,
  parseInviteFromNext,
  verifyToken,
} from "@/lib/invitations";
import { rateLimit, rateLimitByAddress, resetLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { BCRYPT_COST, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import {
  startPending2fa,
  clearPending2fa,
  readPending2fa,
} from "@/lib/pending-2fa";
import { unseal } from "@/lib/secret-box";
import { verifyTotpStep } from "@/lib/totp";
import { claimTotpStep, consumeRecoveryCode } from "@/lib/totp-store";
import { RATE_LIMITS } from "@/lib/rate-limits";
import { passwordBlockedBySso } from "@/lib/sso-policy";
import { oidcConfig } from "@/lib/oidc";
import { beginOidcFlow } from "@/lib/oidc-flow";
import { createFirstAdmin } from "@/lib/first-admin";
import {
  checkSetupToken,
  setupFingerprint,
  setupStatus,
} from "@/lib/setup-token";
import { userNameSchema } from "@/lib/user-name";

const registerSchema = z.object({
  // Dieselbe Regel wie im Profil (lib/user-name): getrimmt, mit Unter-
  // und Obergrenze, gezählt in Codepoints.
  name: userNameSchema,
  // `z.email()` statt der in zod 4 abgekündigten Methodenform
  // `z.string().email()`.
  email: z.email("Ungültige E-Mail"),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Passwort min. ${PASSWORD_MIN_LENGTH} Zeichen`),
});

const loginSchema = z.object({
  email: z.email("Ungültige E-Mail"),
  password: z.string().min(1, "Passwort fehlt"),
});

export type ActionState =
  | {
      error?: string;
      /**
       * Die Anmeldeseite nennt unter der Meldung den SSO-Weg, falls die
       * Instanz einen Anbieter hat. Steht bei jeder Antwort "Falsche
       * Zugangsdaten", für jedes Konto gleich: sie verrät nicht, welches
       * Konto an SSO hängt.
       */
      ssoHinweis?: boolean;
    }
  | undefined;

/**
 * Antwort auf falsche Zugangsdaten, und genauso auf ein richtiges
 * Passwort für ein Konto mit SSO-Bindung (lib/sso-policy): wer das
 * Passwort kennt, soll daraus nicht ablesen, welche Konten an SSO hängen.
 */
const FALSCHE_ZUGANGSDATEN = {
  error: "Falsche Zugangsdaten",
  ssoHinweis: true,
} as const;

/**
 * Vergleichswert für Anmeldungen ohne Konto — ein bcrypt-Hash mit
 * demselben Aufwand wie ein echter. Der Klartext dazu ist niemandem
 * bekannt und wird nirgends gebraucht.
 *
 * Beim Start erzeugt statt fest eingetragen: ein eingetragener Hash
 * trägt den Kostenfaktor in sich ($2a$10$...). Wer BCRYPT_COST anhebt,
 * hätte ihn übersehen, und der Vergleich für unbekannte Adressen liefe
 * wieder messbar schneller als der für bekannte — genau der
 * Unterschied, den dieser Wert verdecken soll.
 */
const DUMMY_HASH = bcrypt.hashSync(
  randomBytes(32).toString("hex"),
  BCRYPT_COST,
);

/** Session anlegen und in die App leiten (gemeinsamer Abschluss von Login/Register). */
async function startSession(
  userId: string,
  tokenVersion: number,
  next?: unknown,
  remember = true,
): Promise<never> {
  await createSession(userId, tokenVersion, { remember });
  redirect(safeNext(next));
}

const NUR_MIT_EINLADUNG =
  "Registrierung ist nur über einen gültigen Einladungslink möglich. " +
  "Öffne den Einladungslink, den du per E-Mail oder direkt bekommen hast.";

/** Antwort, wenn das Einrichtungs-Token fehlt oder nicht stimmt. */
function einrichtungsTokenFehler(status: {
  tokenBereit: boolean;
  tokenDatei: string;
}): string {
  return status.tokenBereit
    ? `Das Einrichtungs-Token stimmt nicht. Du findest es auf dem Server in ${status.tokenDatei}.`
    : "Die Ersteinrichtung ist gesperrt, weil das Einrichtungs-Token nicht " +
        "angelegt werden konnte. Die Ursache steht im Server-Log.";
}

async function registerBremse(): Promise<boolean> {
  return rateLimitByAddress("register", RATE_LIMITS.register);
}

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (formData.get("via") === "sso") return ersteinrichtungUeberSso(formData);

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, password } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  if (!(await registerBremse())) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }

  /**
   * Ersteinrichtung: noch kein Konto. Das erste wird Instanz-Admin, aber
   * nur mit dem Einrichtungs-Token (lib/setup-token), ausser APP_URL und
   * alle Namen dieser Anfrage (Host, X-Forwarded-Host, Forwarded, Origin)
   * zeigen auf diesen Rechner; ohne Origin gilt eine Action nie als
   * lokal. Angelegt wird unter der Sperre der Ersteinrichtung
   * (lib/first-admin), damit zwei gleichzeitige erste Registrierungen
   * nicht beide Admin werden.
   */
  const status = await setupStatus(await headers(), { aktion: true });
  if (status.offen) {
    const setupTokenOk =
      !status.tokenNoetig ||
      (await checkSetupToken(formData.get("setup_token")));
    const decision = decideRegistration({
      isFirstUser: true,
      hasValidInvite: false,
      setupTokenOk,
    });
    if (!decision.allowed) {
      await audit({
        action: "auth.login_failed",
        metadata: { reason: "setup_token", via: "register" },
      });
      return { error: einrichtungsTokenFehler(status) };
    }
    const erstes = await createFirstAdmin(
      { name, email, passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
      { via: "password", tokenNoetig: status.tokenNoetig },
    );
    if (!erstes) {
      return {
        error:
          "Die Ersteinrichtung ist schon abgeschlossen. Melde dich an oder " +
          "lass dich einladen.",
      };
    }
    return startSession(erstes.id, erstes.tokenVersion, formData.get("next"));
  }

  const exists = !!(await prisma.user.findUnique({ where: { email } }));

  /**
   * Der Einladungslink selbst ist der Nachweis, nicht die E-Mail-Adresse.
   * Vorher genügte eine offene Einladung für die Adresse — wer sie kannte,
   * konnte das Konto vorwegnehmen und die eingeladene Person damit
   * dauerhaft aussperren.
   */
  const invite = parseInviteFromNext(formData.get("next"));
  const invitation = invite
    ? await prisma.spaceInvitation.findUnique({
        where: { id: invite.invitationId },
        select: {
          id: true,
          email: true,
          tokenHash: true,
          expiresAt: true,
          acceptedAt: true,
          spaceId: true,
        },
      })
    : null;
  const hasValidInvite =
    !!invitation &&
    !invitation.acceptedAt &&
    invitation.expiresAt.getTime() > Date.now() &&
    invitation.email === email &&
    verifyToken(invite!.token, invitation.tokenHash);

  const decision = decideRegistration({
    isFirstUser: false,
    hasValidInvite,
    setupTokenOk: true,
  });
  // Reihenfolge ist Absicht: ohne gültige Einladung gibt es IMMER dieselbe
  // Antwort — auch für eine bereits registrierte Adresse. Sonst wäre
  // /register ein Orakel dafür, wer auf dieser Instanz ein Konto hat
  // (der Reset-Weg hält denselben Grundsatz bereits ein). Wer eine
  // gültige Einladung für die Adresse vorweist, weiss ohnehin Bescheid
  // und bekommt den hilfreichen Hinweis.
  if (!decision.allowed) return { error: NUR_MIT_EINLADUNG };
  if (exists) {
    return { error: "E-Mail bereits registriert. Bitte melde dich an." };
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      isAdmin: decision.isAdmin,
    },
  });
  await audit({
    action: "auth.registered",
    actorId: user.id,
    spaceId: hasValidInvite ? invitation!.spaceId : null,
    metadata: { isAdmin: decision.isAdmin, viaInvite: hasValidInvite },
  });
  return startSession(user.id, user.tokenVersion, formData.get("next"));
}

/**
 * Erstes Konto über SSO, vom Formular der Anmeldeseite.
 *
 * Das Token wird hier geprüft, vor dem Sprung zum Anbieter, und als
 * Fingerabdruck an den `state` des Flusses gebunden; der Rücksprung
 * prüft den Fingerabdruck (lib/oidc-account). Kein eigener Endpunkt:
 * ein Formular an die Start-Route, die zum Anbieter weiterleitet,
 * blockiert `form-action 'self'` der CSP in Chrome. Die Umleitung aus
 * der Action ist dagegen eine Navigation.
 */
async function ersteinrichtungUeberSso(formData: FormData): Promise<ActionState> {
  if (!(await registerBremse())) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }
  const status = await setupStatus(await headers(), { aktion: true });
  if (!status.offen) return { error: NUR_MIT_EINLADUNG };
  const config = oidcConfig();
  if (!config) {
    return { error: "Single Sign-on ist auf dieser Instanz nicht eingerichtet." };
  }

  let setup: string | undefined;
  if (status.tokenNoetig) {
    const eingabe = formData.get("setup_token");
    if (!(await checkSetupToken(eingabe))) {
      await audit({
        action: "auth.login_failed",
        metadata: { reason: "setup_token", via: "register_sso" },
      });
      return { error: einrichtungsTokenFehler(status) };
    }
    setup = setupFingerprint(String(eingabe));
  }

  let ziel: string;
  try {
    ziel = await beginOidcFlow(config, {
      next: safeNext(formData.get("next")),
      ...(setup ? { setup } : {}),
    });
  } catch (e) {
    log.error({ err: e }, "OIDC-Start fehlgeschlagen");
    return { error: "Die Anmeldung über den Anbieter hat nicht geklappt." };
  }
  redirect(ziel);
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Zwei Bremsen: pro IP (ein Angreifer, viele Konten) UND pro Konto
  // (viele IPs, ein Konto — Passwort-Raten aus einem Botnetz). Die pro IP
  // ist bewusst grosszügiger: hinter einer Firmen-NAT teilen sich viele
  // Menschen eine Adresse, und ausgenommene Netze
  // (RATE_LIMIT_EXEMPT_NETWORKS) zählen gar nicht. Die präzise Bremse ist
  // die pro Konto; sie gilt auch dort.
  if (!(await rateLimitByAddress("login", RATE_LIMITS.loginIp))) {
    return { error: "Zu viele Versuche. Bitte später erneut." };
  }

  const email = normalizeEmail(parsed.data.email);
  const accountKey = `login:account:${email}`;
  /**
   * Zählen und Prüfen in einem Schritt, VOR dem bcrypt-Vergleich.
   *
   * Vorher wurde hier nur gelesen und erst nach dem Vergleich gezählt.
   * Dazwischen liegt ein bewusst langsamer Schritt, also lasen
   * gleichzeitig eintreffende Versuche alle denselben Stand und kamen
   * alle durch: die Bremse begrenzte nur die Zahl der Schübe, pro Schub
   * waren so viele Versuche möglich, wie die IP-Bremse durchliess.
   * Erfolgreiche Anmeldungen räumt `resetLimit` weiter unten wieder ab.
   */
  if (
    !(await rateLimit(
      accountKey,
      RATE_LIMITS.login.versuche,
      RATE_LIMITS.login.fenster,
    ))
  ) {
    await audit({
      action: "auth.login_failed",
      metadata: { email, reason: "throttled" },
    });
    return {
      error:
        "Zu viele Fehlversuche für dieses Konto. Bitte in 15 Minuten erneut.",
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  /**
   * Auch ohne Konto wird gehasht.
   *
   * Sonst kostet ein Fehlversuch gegen eine bekannte Adresse den vollen
   * bcrypt-Aufwand und gegen eine unbekannte fast nichts — der
   * Unterschied ist messbar und verrät, welche Konten es gibt. Die
   * Fehlermeldung ist längst generisch; die Laufzeit muss es auch sein.
   */
  const passwordOk = user
    ? await bcrypt.compare(parsed.data.password, user.passwordHash)
    : await bcrypt.compare(parsed.data.password, DUMMY_HASH).then(() => false);
  if (!user || !passwordOk) {
    await audit({
      action: "auth.login_failed",
      actorId: user?.id ?? null,
      metadata: { email, reason: "bad_credentials" },
    });
    return FALSCHE_ZUGANGSDATEN;
  }
  /**
   * Konto mit SSO-Bindung: kein Passwortweg, auch mit richtigem Passwort
   * und vor dem zweiten Faktor. Die Antwort ist dieselbe wie bei einem
   * falschen Passwort, nur das Audit hält den Grund fest. Keine Rückgabe
   * des Platzes der Kontobremse: nach aussen war es ein Fehlversuch.
   */
  if (passwordBlockedBySso(user)) {
    await audit({
      action: "auth.login_failed",
      actorId: user.id,
      metadata: { email, reason: "sso_required" },
    });
    return FALSCHE_ZUGANGSDATEN;
  }
  if (!user.isActive) {
    await audit({
      action: "auth.login_failed",
      actorId: user.id,
      metadata: { email, reason: "inactive" },
    });
    return { error: "Dieses Konto ist deaktiviert." };
  }

  await resetLimit(accountKey);

  // Zweiter Faktor: die Sitzung entsteht erst nach dem Code.
  if (user.totpEnabledAt) {
    await startPending2fa(user.id, safeNext(formData.get("next")), "password");
    redirect("/login/2fa");
  }

  await audit({ action: "auth.login_succeeded", actorId: user.id });
  // Ohne Haken endet die Anmeldung mit dem Browserfenster.
  return startSession(
    user.id,
    user.tokenVersion,
    formData.get("next"),
    formData.get("remember") === "on",
  );
}

/**
 * Zweiter Schritt der Anmeldung: Einmalkennwort oder
 * Wiederherstellungscode.
 *
 * Auch hier greift eine Bremse pro Konto: sonst liesse sich der
 * sechsstellige Code schlicht durchprobieren.
 */
export async function completeTotpLoginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const pending = await readPending2fa();
  if (!pending) {
    return { error: "Der Anmeldevorgang ist abgelaufen. Bitte neu beginnen." };
  }

  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Code fehlt" };

  const brakeKey = `login:totp:${pending.userId}`;
  if (
    !(await rateLimit(
      brakeKey,
      RATE_LIMITS.login.versuche,
      RATE_LIMITS.login.fenster,
    ))
  ) {
    return { error: "Zu viele Versuche. Bitte in 15 Minuten erneut." };
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: {
      id: true,
      isActive: true,
      tokenVersion: true,
      totpSecret: true,
      totpEnabledAt: true,
      oidcSubject: true,
    },
  });
  if (!user || !user.isActive || !user.totpEnabledAt || !user.totpSecret) {
    await clearPending2fa();
    return { error: "Anmeldung nicht möglich." };
  }
  /**
   * Erster Schritt mit Passwort, und das Konto hängt inzwischen an SSO
   * (gebunden nach dem ersten Schritt, oder ein Zwischenschritt von vor
   * dem Update): kein Passwortweg, wie in loginAction. Geprüft vor dem
   * Code, damit er nicht verbraucht wird. Nach einer SSO-Anmeldung gilt
   * der zweite Schritt weiter.
   */
  if (pending.via === "password" && passwordBlockedBySso(user)) {
    await clearPending2fa();
    await audit({
      action: "auth.login_failed",
      actorId: user.id,
      metadata: { reason: "sso_required", via: "second_factor" },
    });
    return { error: "Anmeldung nicht möglich." };
  }

  const secret = unseal(user.totpSecret);
  const step = secret ? verifyTotpStep(secret, code) : null;

  /**
   * Ein passender Code allein genügt nicht: derselbe Code darf innerhalb
   * seines Fensters kein zweites Mal öffnen (RFC 6238, Abschnitt 5.2).
   * Wer ihn abgelesen oder abgefangen hat, kommt damit nicht hinterher.
   * Der Vermerk läuft als bedingtes Update, damit auch zwei gleichzeitige
   * Versuche nicht beide durchgehen.
   */
  const codeOk = step === null ? false : await claimTotpStep(user.id, step);
  const replayed = step !== null && !codeOk;
  const recoveryOk =
    step !== null ? false : await consumeRecoveryCode(user.id, code);

  if (!codeOk && !recoveryOk) {
    /**
     * `unseal` meldet null auch dann, wenn APP_SECRET gewechselt hat
     * oder der Wert beschädigt ist — nicht nur bei einem falschen Code.
     * Ohne diese Unterscheidung stünde dort "Code stimmt nicht.", die
     * Person suchte den Fehler bei ihrem Authenticator, und im Betrieb
     * fiele nichts auf. Geprüft wird es erst hier: der
     * Wiederherstellungscode hängt nicht am Schlüssel und bleibt auch
     * dann der Weg zurück ins Konto.
     */
    const unreadable = !secret;
    if (unreadable) {
      log.error({ userId: user.id }, "totp secret unreadable");
    }
    await audit({
      action: "auth.login_failed",
      actorId: user.id,
      metadata: {
        reason: unreadable
          ? "totp_secret_unreadable"
          : replayed
            ? "totp_replay"
            : "bad_totp",
      },
    });
    return {
      error: unreadable
        ? "Der zweite Faktor lässt sich zurzeit nicht prüfen. Nutze einen " +
          "Wiederherstellungscode oder wende dich an die Administration."
        : replayed
          ? "Dieser Code wurde schon verwendet. Warte auf den nächsten."
          : "Code stimmt nicht.",
    };
  }

  await resetLimit(brakeKey);
  await clearPending2fa();
  await audit({
    action: "auth.login_succeeded",
    actorId: user.id,
    metadata: { second_factor: recoveryOk ? "recovery" : "totp" },
  });
  return startSession(
    user.id,
    user.tokenVersion,
    pending.next,
    formData.get("remember") === "on",
  );
}
