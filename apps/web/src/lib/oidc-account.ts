import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@dokunc/db";
import { audit } from "./audit";
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
    await audit({
      action: "auth.sso_linked",
      actorId: linked.id,
      metadata: { issuer },
    });
    return { user: linked };
  }

  // Neues Konto: nur wenn die Instanz das ausdrücklich erlaubt — oder
  // wenn es noch gar keines gibt, dann wird es wie sonst auch Admin.
  const isFirstUser = (await prisma.user.count()) === 0;
  if (!allowSignup && !isFirstUser) return { reason: "no_account" };
  if (!claims.emailVerified && !isFirstUser) return { reason: "unverified" };

  const created = await prisma.user.create({
    data: {
      email: claims.email,
      name: claims.name || claims.email.split("@")[0],
      // Kein nutzbares Passwort: die Anmeldung läuft über den Anbieter.
      // Wer eines will, setzt es über „Passwort vergessen".
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
      isAdmin: isFirstUser,
      oidcSubject: claims.subject,
      oidcIssuer: issuer,
    },
    select,
  });
  await audit({
    action: "auth.registered",
    actorId: created.id,
    metadata: { via: "sso", isAdmin: isFirstUser },
  });
  return { user: created };
}
