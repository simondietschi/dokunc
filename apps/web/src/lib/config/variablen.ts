import {
  GEMEINSAME_VARIABLEN,
  defineVariable,
  type Variable,
} from "@dokunc/config";
import {
  parseClaimList,
  parseClaimName,
  parseSubjectClaim,
  parseTrustedDomains,
  type SubjectClaim,
} from "@/lib/oidc-claims";
import { parseSetupTokenFile } from "@/lib/setup-token";
import { parseSsoEnforcement, type SsoEnforcement } from "@/lib/sso-policy";

/**
 * Variablen, die nur die Web-App liest. Nach `name` sortiert
 * (konfiguration.test.ts prueft das). Parser liegen beim Code, der den
 * Wert nutzt; wie eine Variable dazukommt, steht in
 * packages/config/README.md.
 *
 * Ohne `import "server-only"`, damit der Gleichlauftest die Liste laden
 * kann; den Schutz traegt ./index.ts.
 */
export const NUR_WEB_VARIABLEN: readonly Variable[] = [
  defineVariable<string[]>({
    name: "OIDC_EMAIL_CLAIM",
    dienste: ["web"],
    beschreibung:
      "Claims that carry the email address, in order, separated by commas (at most 5). Claims other than `email` are used only for addresses in OIDC_TRUSTED_EMAIL_DOMAINS.",
    vorgabe: "email",
    parse: (roh) => parseClaimList(roh),
    querpruefung: {
      liest: ["OIDC_TRUSTED_EMAIL_DOMAINS"],
      pruefe(wert, werte) {
        const andere = wert.filter((c) => c !== "email");
        const domains = werte.OIDC_TRUSTED_EMAIL_DOMAINS as
          | readonly string[]
          | undefined;
        if (andere.length === 0 || (domains && domains.length > 0)) return {};
        return {
          hinweise: [
            `OIDC_EMAIL_CLAIM nennt ${andere.join(", ")}, aber OIDC_TRUSTED_EMAIL_DOMAINS ist leer: ` +
              "andere Claims als email zählen nur für Adressen auf vertrauten Domains und bleiben so ohne Wirkung",
          ],
        };
      },
    },
  }),
  defineVariable<string>({
    name: "OIDC_NAME_CLAIM",
    dienste: ["web"],
    beschreibung:
      "Claim for the display name. Falls back to `name`, then `preferred_username`.",
    vorgabe: "name",
    parse: (roh) => parseClaimName(roh),
  }),
  defineVariable<SubjectClaim>({
    name: "OIDC_SUBJECT_CLAIM",
    dienste: ["web"],
    beschreibung:
      "Claim that identifies a person permanently: `sub` or `oid`. For Microsoft Entra ID use `oid` (its `sub` differs per app registration). Switching from `sub` moves each binding on the person's next sign-in.",
    vorgabe: "sub",
    parse: (roh) => parseSubjectClaim(roh),
    querpruefung: {
      // OIDC_SCOPES hat noch keine eigene Deklaration; gelesen wird der
      // Rohwert mit derselben Vorgabe wie in lib/oidc.ts.
      liest: [],
      pruefe(wert, _werte, env) {
        const scopes = (
          env.OIDC_SCOPES?.trim() || "openid email profile"
        ).split(/\s+/);
        if (wert !== "oid" || scopes.includes("profile")) return {};
        return {
          hinweise: [
            "OIDC_SUBJECT_CLAIM ist oid, OIDC_SCOPES enthält aber nicht profile: " +
              "Entra ID schickt oid nur mit profile, jede SSO-Anmeldung scheitert dann",
          ],
        };
      },
    },
  }),
  defineVariable<string[]>({
    name: "OIDC_TRUSTED_EMAIL_DOMAINS",
    dienste: ["web"],
    beschreibung:
      "Email domains whose addresses count as verified when the identity provider sends neither `email_verified` nor `xms_edov`, separated by commas or spaces (at most 100). List only domains your organisation controls, never public mail domains.",
    parse: (roh) => parseTrustedDomains(roh),
  }),
  defineVariable<string>({
    name: "SETUP_TOKEN_FILE",
    dienste: ["web"],
    beschreibung:
      "File that holds the one-time setup token for the first account (absolute path). Only needed outside the Docker image, whose default is on the app_data volume.",
    vorgabe: "/app/data/setup_token",
    // Die Vorgabe passt zum Image; Compose reicht den Wert nicht durch.
    inCompose: false,
    parse: (roh) => parseSetupTokenFile(roh),
  }),
  defineVariable<SsoEnforcement>({
    name: "SSO_ENFORCEMENT",
    dienste: ["web"],
    beschreibung:
      "`linked_accounts`: accounts linked to a single sign-on provider (any issuer) cannot sign in with a password or reset it. `off`: they can, for example while the provider is down. Case-insensitive.",
    vorgabe: "linked_accounts",
    parse: (roh) => parseSsoEnforcement(roh),
  }),
];

/** Alles, was die Web-App beim Start prueft. */
export const WEB_VARIABLEN: readonly Variable[] = [
  ...GEMEINSAME_VARIABLEN.filter((v) => v.dienste.includes("web")),
  ...NUR_WEB_VARIABLEN,
];
