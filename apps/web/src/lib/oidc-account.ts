import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@dokunc/db";
import { audit } from "./audit";
import { decideRegistration } from "./registration";
import { createFirstAdmin } from "./first-admin";
import { checkSetupFingerprint, setupStatus } from "./setup-token";
import { BCRYPT_COST } from "./password-policy";
import { ssoUserName } from "./user-name";
import type { OidcClaims } from "./oidc";

/**
 * Wer steckt hinter den Angaben des Anbieters?
 *
 * Eigene Datei und nicht in der Route: hier haengt die Frage, ob eine
 * SSO-Anmeldung ein bestehendes Konto uebernehmen darf. Das laesst sich
 * nur gegen eine echte Datenbank pruefen, und geprueft gehoert es.
 */
export type OidcOptions = {
  issuer: string;
  /** Darf der Anbieter neue Konten anlegen? */
  allowSignup: boolean;
  /** Darf eine bestaetigte Adresse ein bestehendes Konto verknuepfen? */
  autoLinkByEmail: boolean;
  /**
   * Fingerabdruck des Einrichtungs-Tokens aus dem Fluss (lib/oidc-state),
   * fuer das erste Konto der Instanz.
   */
  setupProof?: string | null;
  /** Host der Anfrage: ohne Token geht das erste Konto nur auf diesem Rechner. */
  host?: string | null;
};

export type Resolved =
  | { user: { id: string; tokenVersion: number; totpEnabledAt: Date | null } }
  | { reason: string };

/**
 * Findet oder erstellt das Konto zu den Angaben des Anbieters.
 *
 * Gebunden wird an das Subject. Eine E-Mail-Adresse verknüpft ein
 * bestehendes Konto nur, wenn der Anbieter sie ausdrücklich als
 * bestätigt meldet — sonst könnte dort jemand eine fremde Adresse
 * eintragen und damit dieses Konto übernehmen.
 */
export async function resolveOidcUser(
  claims: OidcClaims,
  options: OidcOptions,
): Promise<Resolved> {
  const { issuer, allowSignup } = options;
  const select = {
    id: true,
    isActive: true,
    tokenVersion: true,
    totpEnabledAt: true,
  } as const;
  const autoLink = options.autoLinkByEmail;

  // Aussteller und Subject zusammen: ein Subject ist nur beim eigenen
  // Anbieter eindeutig. Wechselt eine Instanz den Anbieter, sollen alte
  // Kennungen nicht plötzlich zu neuen Personen passen.
  const bySubject = await prisma.user.findFirst({
    where: { oidcIssuer: issuer, oidcSubject: claims.subject },
    select,
  });
  if (bySubject) {
    return bySubject.isActive ? { user: bySubject } : { reason: "inactive" };
  }

  /**
   * Umstellung der Bindung: OIDC_SUBJECT_CLAIM ist nicht mehr `sub`
   * (für Entra ID `oid`), das Konto hängt aber noch am `sub` dieses
   * Ausstellers. Sicher, weil `sub` beim selben Aussteller und derselben
   * App-Registrierung dieselbe Person bezeichnet und die Bindung vorher
   * genau darauf lag. So bricht die Umstellung auf einer laufenden
   * Instanz nichts: jede Person wandert bei ihrer nächsten Anmeldung.
   * Der neue Wert kann nie ein altes `sub` treffen (lib/oidc-claims,
   * bestimmeSubject).
   */
  if (claims.legacySubject) {
    const bisher = await prisma.user.findFirst({
      where: { oidcIssuer: issuer, oidcSubject: claims.legacySubject },
      select,
    });
    if (bisher) {
      if (!bisher.isActive) return { reason: "inactive" };
      const umgestellt = await prisma.user.update({
        where: { id: bisher.id },
        data: { oidcSubject: claims.subject },
        select,
      });
      await audit({
        action: "auth.sso_linked",
        actorId: umgestellt.id,
        metadata: { issuer, subjectClaim: "oid", previousClaim: "sub" },
      });
      return { user: umgestellt };
    }
  }

  if (!claims.email) return { reason: "no_email" };

  const byEmail = await prisma.user.findUnique({
    where: { email: claims.email },
    select: { ...select, oidcSubject: true, isAdmin: true },
  });
  if (byEmail) {
    if (!autoLink) return { reason: "no_link" };
    if (!claims.emailVerified) return { reason: "unverified" };
    if (byEmail.oidcSubject) return { reason: "linked_elsewhere" };
    if (!byEmail.isActive) return { reason: "inactive" };
    /**
     * Ein Admin-Konto wird nie im Vorbeigehen verknüpft.
     *
     * Wird eine Adresse im Verzeichnis neu vergeben — Nachfolge, Alias,
     * ausgeschiedene Person — übernähme die neue Inhaberin sonst beim
     * ersten Klick das alte Konto samt seiner Rechte. Für ein gewöhnliches
     * Konto ist das eine Unannehmlichkeit, für ein Admin-Konto die
     * Instanz.
     */
    if (byEmail.isAdmin) return { reason: "admin_link" };

    const linked = await prisma.user.update({
      where: { id: byEmail.id },
      data: { oidcSubject: claims.subject, oidcIssuer: issuer },
      select,
    });
    // Quelle und Grund der Bestätigung: die Spur, falls eine Verknüpfung
    // über die Adresse später untersucht werden muss.
    await audit({
      action: "auth.sso_linked",
      actorId: linked.id,
      metadata: {
        issuer,
        emailSource: claims.emailSource ?? null,
        verifiedBy: claims.verifiedBy ?? null,
      },
    });
    return { user: linked };
  }

  /**
   * Neues Konto: dieselbe Zugangsregel wie beim Passwortweg, aus
   * derselben Funktion (lib/registration).
   *
   * Solange es gar kein Konto gibt (Ersteinrichtung), wird das erste
   * Instanz-Admin, aber nur mit dem Fingerabdruck des Einrichtungs-Tokens
   * aus dem Fluss (die Anmeldeseite hat das Token vor dem Sprung zum
   * Anbieter geprüft), ausser APP_URL und Host zeigen auf diesen Rechner.
   * `OIDC_ALLOW_SIGNUP` spielt dafür keine Rolle. Eine bestätigte Adresse
   * braucht auch das erste Konto; früher wurde die allererste Person ohne
   * sie Admin. Angelegt wird unter der Sperre der Ersteinrichtung; war
   * jemand schneller, gilt der gewöhnliche Weg.
   */
  const status = await setupStatus(options.host ?? null);
  if (status.offen) {
    const setupTokenOk =
      !status.tokenNoetig ||
      (await checkSetupFingerprint(options.setupProof ?? null));
    const erste = decideRegistration({
      isFirstUser: true,
      hasValidInvite: allowSignup,
      setupTokenOk,
    });
    if (!erste.allowed) return { reason: "setup_token" };
    if (!claims.emailVerified) return { reason: "unverified" };
    const erstes = await createFirstAdmin(
      {
        email: claims.email,
        name: ssoUserName(claims.name, claims.email),
        passwordHash: await zufallsHash(),
        oidcSubject: claims.subject,
        oidcIssuer: issuer,
      },
      {
        via: "sso",
        tokenNoetig: status.tokenNoetig,
        verifiedBy: claims.verifiedBy ?? null,
      },
    );
    if (erstes) return { user: erstes };
  }

  const decision = decideRegistration({
    isFirstUser: false,
    hasValidInvite: allowSignup,
    setupTokenOk: true,
  });
  if (!decision.allowed) return { reason: "no_account" };
  if (!claims.emailVerified) return { reason: "unverified" };

  const created = await prisma.user.create({
    data: {
      email: claims.email,
      // Dieselbe Namensregel wie Registrierung und Profil (lib/user-name):
      // der Claim kommt ohne Grenze, und ein Name ausserhalb der Regel
      // sperrte spaeter das Profilformular.
      name: ssoUserName(claims.name, claims.email),
      passwordHash: await zufallsHash(),
      isAdmin: decision.isAdmin,
      oidcSubject: claims.subject,
      oidcIssuer: issuer,
    },
    select,
  });
  await audit({
    action: "auth.registered",
    actorId: created.id,
    metadata: {
      via: "sso",
      isAdmin: decision.isAdmin,
      emailSource: claims.emailSource ?? null,
      verifiedBy: claims.verifiedBy ?? null,
    },
  });
  return { user: created };
}

/**
 * Kein nutzbares Passwort: die Anmeldung läuft über den Anbieter, und
 * für Konten mit SSO-Bindung gibt es weder Passwortanmeldung noch Reset
 * (lib/sso-policy). Kostenfaktor trotzdem aus lib/password-policy und
 * nicht nackt: sonst trüge ausgerechnet dieser Hash dauerhaft die alte
 * Zahl in sich, falls BCRYPT_COST einmal angehoben wird.
 */
function zufallsHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("hex"), BCRYPT_COST);
}
