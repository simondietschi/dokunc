import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OidcClaims } from "@/lib/oidc-claims";

/**
 * Faelle der SSO-Anmeldung ueber die Konten des Test-IdP
 * (e2e/test-idp/konten.json), einmal fuer beide Laeufe:
 * src/lib/oidc-claims.test.ts wendet die Regeln ohne Netz auf die
 * aufgezeichneten Claims an, test/integration/oidc-idp.test.ts faehrt
 * dieselben Faelle ueber das echte Protokoll gegen den IdP.
 */

export type Konto = {
  quelle: string;
  id_token: Record<string, unknown>;
  userinfo: Record<string, unknown>;
};

export function testIdpKonten(): Record<string, Konto> {
  const datei = fileURLToPath(
    new URL("../../../e2e/test-idp/konten.json", import.meta.url),
  );
  return JSON.parse(readFileSync(datei, "utf8")) as Record<string, Konto>;
}

/** Was ein Fall ueber die Umgebung einstellt. */
export const FALL_VARIABLEN = [
  "OIDC_TRUSTED_EMAIL_DOMAINS",
  "OIDC_EMAIL_CLAIM",
  "OIDC_NAME_CLAIM",
  "OIDC_SUBJECT_CLAIM",
] as const;
export type FallUmgebung = Partial<
  Record<(typeof FALL_VARIABLEN)[number], string>
>;

export type IdpFall = {
  name: string;
  konto: string;
  umgebung?: FallUmgebung;
  /** Erwartete Claims; `sub` ist das Subject, das der Anbieter schickt. */
  erwartet(sub: string): Partial<OidcClaims>;
};

const ENTRA_OID = "3f2c9b1e-5a7d-4e8f-9c0b-1d2e3f4a5b6c";

/** Adresse, Bestaetigung, Quelle und Grund in einem. */
function adresse(
  email: string | null,
  verifiedBy: OidcClaims["verifiedBy"],
  emailSource: string | null = email ? "email" : null,
): Partial<OidcClaims> {
  return { email, emailVerified: verifiedBy !== null, emailSource, verifiedBy };
}

export const IDP_FAELLE: readonly IdpFall[] = [
  {
    name: "Google: bestätigte Adresse (email_verified)",
    konto: "google",
    erwartet: (sub) => ({
      subject: sub,
      legacySubject: null,
      name: "Sam Google",
      ...adresse("sam@google.test", "email_verified"),
    }),
  },
  {
    name: "Keycloak: bestätigte Adresse (email_verified)",
    konto: "keycloak",
    erwartet: () => adresse("robin@keycloak.test", "email_verified"),
  },
  {
    name: "authentik: bestätigte Adresse (email_verified)",
    konto: "authentik",
    erwartet: () => adresse("kai@authentik.test", "email_verified"),
  },
  {
    name: "Entra ID: xms_edov bestätigt die Adresse",
    konto: "entra-mitglied",
    erwartet: () => adresse("alex.muster@entra.test", "xms_edov"),
  },
  {
    name: "Entra ID ohne Adresse im ID-Token: Adresse aus Userinfo, unbestätigt",
    konto: "entra-ohne-email",
    erwartet: () => ({
      name: "Kim Beispiel",
      ...adresse("kim.beispiel@entra.test", null, "email"),
    }),
  },
  {
    name: "Entra ID ohne Adresse im ID-Token: vertraute Domain bestätigt die Adresse aus Userinfo",
    konto: "entra-ohne-email",
    umgebung: { OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test" },
    erwartet: () => adresse("kim.beispiel@entra.test", "domain"),
  },
  {
    name: "Entra ID ohne Postfach: ohne Claim-Liste keine Adresse",
    konto: "entra-nur-upn",
    erwartet: () => adresse(null, null),
  },
  {
    name: "Entra ID ohne Postfach: UPN auf vertrauter Domain aus der Claim-Liste",
    konto: "entra-nur-upn",
    umgebung: {
      OIDC_EMAIL_CLAIM: "email,preferred_username",
      OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test",
    },
    erwartet: () =>
      adresse("upn.only@entra.test", "domain", "preferred_username"),
  },
  {
    name: "Entra ID ohne Postfach: UPN ohne vertraute Domain zählt nicht",
    konto: "entra-nur-upn",
    umgebung: { OIDC_EMAIL_CLAIM: "email,preferred_username" },
    erwartet: () => adresse(null, null),
  },
  {
    name: "Entra-Gast: fremde Adresse bleibt, auch wenn die UPN-Domain vertraut ist",
    konto: "entra-gast",
    umgebung: {
      OIDC_EMAIL_CLAIM: "email,preferred_username",
      OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test entratest.onmicrosoft.com",
    },
    erwartet: () => adresse("gast@extern.test", null),
  },
  {
    name: "Entra-Gast aus fremdem Tenant mit Adresse auf vertrauter Domain: unbestätigt",
    konto: "entra-gast-vertraute-domain",
    umgebung: { OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test" },
    erwartet: () => adresse("chefin@entra.test", null),
  },
  {
    name: "Entra ID mit Claim-Liste: Userinfo-Adresse vor dem UPN der Start-Domain",
    konto: "entra-ohne-email",
    umgebung: {
      OIDC_EMAIL_CLAIM: "email,preferred_username",
      OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test",
    },
    erwartet: () => adresse("kim.beispiel@entra.test", "domain"),
  },
  {
    name: "Keycloak: ausdrückliches email_verified false schlägt die vertraute Domain",
    konto: "keycloak-unbestaetigt",
    umgebung: { OIDC_TRUSTED_EMAIL_DOMAINS: "entra.test" },
    erwartet: () => adresse("chef@entra.test", null),
  },
  {
    name: "schlankes ID-Token: email_verified aus Userinfo",
    konto: "userinfo-bestaetigt",
    erwartet: () => adresse("lou@schlank.test", "email_verified"),
  },
  {
    name: "Entra ID: OIDC_SUBJECT_CLAIM=oid bindet an die Objekt-ID",
    konto: "entra-mitglied",
    umgebung: { OIDC_SUBJECT_CLAIM: "oid" },
    erwartet: (sub) => ({ subject: ENTRA_OID, legacySubject: sub }),
  },
  {
    name: "OIDC_NAME_CLAIM wählt den Claim für den Namen",
    konto: "google",
    umgebung: { OIDC_NAME_CLAIM: "given_name" },
    erwartet: () => ({ name: "Sam" }),
  },
];
