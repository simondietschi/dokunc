import { domainToASCII } from "node:url";
import type { Ergebnis, Umgebung } from "@dokunc/config";
import { normalizeEmail } from "./invitations";

/**
 * Was die SSO-Anmeldung aus den Claims des Anbieters liest: Adresse (und
 * ob sie bestaetigt ist), Name und die Kennung, an die das Konto
 * gebunden wird. Dazu die Parser der Variablen, die diese Regeln
 * einstellen; das Konfigurationsschema (lib/config/variablen.ts) ruft
 * dieselben Parser beim Start auf.
 *
 * Ohne Log und ohne Netz, damit Unit-Tests jede Regel einzeln pruefen
 * koennen. Den Abruf von Userinfo und die Meldungen im Log macht
 * lib/oidc.ts.
 */

/** Worauf die Bestaetigung einer Adresse beruht. */
export type VerifiedBy = "email_verified" | "xms_edov" | "domain";

export type OidcClaims = {
  subject: string;
  /** `sub`, wenn OIDC_SUBJECT_CLAIM ein anderer Claim ist, sonst null. */
  legacySubject?: string | null;
  email: string | null;
  emailVerified: boolean;
  /** Claim, aus dem die Adresse stammt. */
  emailSource?: string | null;
  /** Worauf die Bestaetigung beruht; null = unbestaetigt. */
  verifiedBy?: VerifiedBy | null;
  name: string | null;
};

/** Kennungen, die eine Person dauerhaft bezeichnen (OIDC_SUBJECT_CLAIM). */
export const SUBJECT_CLAIMS = ["sub", "oid"] as const;
export type SubjectClaim = (typeof SUBJECT_CLAIMS)[number];

export type ClaimRegeln = {
  /** Domains in ASCII-Kleinschreibung (Punycode). */
  trustedEmailDomains: readonly string[];
  /** Claims mit der Adresse, in dieser Reihenfolge. */
  emailClaims: readonly string[];
  nameClaim: string;
  subjectClaim: SubjectClaim;
};

/** Ohne eigene Einstellung: nur `email`, keine vertrauten Domains. */
export const VORGABE_REGELN: ClaimRegeln = {
  trustedEmailDomains: [],
  emailClaims: ["email"],
  nameClaim: "name",
  subjectClaim: "sub",
};

/**
 * Grobe Form einer Adresse: genau ein „@", links und rechts davon etwas
 * ohne Leerraum.
 *
 * Bewusst nicht strenger — massgeblich ist das Verzeichnis des
 * Anbieters, und dort kommen Adressen ohne Punkt in der Domain
 * („alex@intranet") vor. Ein blosses `includes("@")` liesse dagegen den
 * Claim „@" durch: der wanderte als eindeutiger Schlüssel in die
 * Benutzertabelle und ergäbe beim Anlegen über `split("@")[0]` ein Konto
 * mit leerem Anzeigenamen. 254 Zeichen ist die Obergrenze einer Adresse
 * nach RFC 5321; ohne sie landet ein beliebig langer Claim in derselben
 * Spalte.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/** Höchstlänge einer Kennung; so lang darf `oidcSubject` werden. */
const SUBJECT_MAX_LENGTH = 255;

/** Objekt-ID von Entra ID: eine GUID. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adresseAus(wert: unknown): string | null {
  // normalizeEmail und nicht von Hand trimmen: die Adresse wird gleich
  // als eindeutiger Schlüssel gegen dieselbe Spalte gesucht, die der
  // Passwortweg füllt — dieselbe Schreibweise muss dabei denselben
  // Datensatz treffen.
  if (typeof wert !== "string") return null;
  const kandidat = normalizeEmail(wert);
  return kandidat.length <= EMAIL_MAX_LENGTH && EMAIL_SHAPE.test(kandidat)
    ? kandidat
    : null;
}

/** Domain in der Form, in der die Liste sie führt; "" = unbrauchbar. */
function asciiDomain(domain: string): string {
  return domainToASCII(domain.trim().toLowerCase());
}

function vertraut(email: string, regeln: ClaimRegeln): boolean {
  const domain = asciiDomain(email.slice(email.lastIndexOf("@") + 1));
  return domain !== "" && regeln.trustedEmailDomains.includes(domain);
}

/**
 * Gilt die Domainregel für dieses Token?
 *
 * Nicht für Gäste aus einem anderen Verzeichnis: Entra ID nennt deren
 * Heimat-Tenant in `idp`, der dann vom Aussteller abweicht. Ein Gast
 * kann dort eine Adresse auf einer Domain des einladenden Tenants
 * tragen, ohne dass dieser Tenant sie je geprüft hat.
 */
function domainRegelGilt(claims: Record<string, unknown>): boolean {
  const { idp, iss } = claims;
  return !(typeof idp === "string" && idp !== "" && idp !== iss);
}

/**
 * Was der Anbieter ausdrücklich über die Adresse aus `email` sagt, oder
 * null. Ein ausdrückliches Nein ist endgültig: es schlägt auch eine
 * vertraute Domain. Sonst übernähme bei Keycloak mit Selbstregistrierung
 * jemand mit einer selbst eingetragenen Adresse der eigenen Firma das
 * Konto der echten Person. Nur echte Wahrheitswerte zählen als Ja; der
 * Text "true" hebt nichts (so war es schon vorher).
 */
function aussage(
  claims: Record<string, unknown>,
): { bestaetigt: boolean; durch: "email_verified" | "xms_edov" } | null {
  for (const durch of ["email_verified", "xms_edov"] as const) {
    const wert = claims[durch];
    if (wert === true) return { bestaetigt: true, durch };
    if (wert === false || wert === "false") return { bestaetigt: false, durch };
  }
  return null;
}

type Adresse = Pick<
  OidcClaims,
  "email" | "emailVerified" | "emailSource" | "verifiedBy"
>;

const KEINE_ADRESSE: Adresse = {
  email: null,
  emailVerified: false,
  emailSource: null,
  verifiedBy: null,
};

/**
 * Die Adresse nach OIDC_EMAIL_CLAIM: der erste Claim der Liste, der
 * eine Adresse liefert, entscheidet.
 *
 * - `email` zählt immer, auch unbestätigt. Liefert er eine Adresse,
 *   endet die Suche: eine Adresse, die der Anbieter nennt, ersetzt kein
 *   anderer Claim.
 * - Jeder andere Claim (`preferred_username`, `upn`, eigene) zählt nur
 *   mit einer Adresse auf einer vertrauten Domain und gilt dann als über
 *   die Domain bestätigt. Sonst wird er übersprungen: bei Keycloak oder
 *   authentik mit Selbstregistrierung wählen Personen ihren
 *   Benutzernamen selbst, auch in Adressform.
 */
export function bestimmeAdresse(
  claims: Record<string, unknown>,
  regeln: ClaimRegeln,
): Adresse {
  const domainRegel = domainRegelGilt(claims);
  for (const claim of regeln.emailClaims) {
    const email = adresseAus(claims[claim]);
    if (!email) continue;
    if (claim === "email") {
      const a = aussage(claims);
      if (a) {
        return {
          email,
          emailVerified: a.bestaetigt,
          emailSource: claim,
          verifiedBy: a.bestaetigt ? a.durch : null,
        };
      }
      const perDomain = domainRegel && vertraut(email, regeln);
      return {
        email,
        emailVerified: perDomain,
        emailSource: claim,
        verifiedBy: perDomain ? "domain" : null,
      };
    }
    if (domainRegel && vertraut(email, regeln)) {
      return {
        email,
        emailVerified: true,
        emailSource: claim,
        verifiedBy: "domain",
      };
    }
  }
  return KEINE_ADRESSE;
}

/**
 * Soll die Anmeldung zusätzlich Userinfo fragen?
 *
 * Ja, wenn das ID-Token nach den Regeln keine Adresse liefert (Entra ID
 * ohne den optionalen Claim `email`), oder wenn es eine Adresse aus
 * `email` trägt, aber weder `email_verified` noch `xms_edov`: Anbieter
 * mit schlankem ID-Token schicken die Bestätigung nur dort (OpenID
 * Connect Core 5.4).
 */
export function brauchtUserinfo(
  idToken: Record<string, unknown>,
  regeln: ClaimRegeln,
): boolean {
  const adresse = bestimmeAdresse(idToken, regeln);
  if (!adresse.email) return true;
  return adresse.emailSource === "email" && aussage(idToken) === null;
}

/** Name: eigener Claim, dann `name`, dann `preferred_username`. */
export function bestimmeName(
  claims: Record<string, unknown>,
  nameClaim: string,
): string | null {
  for (const claim of new Set([nameClaim, "name", "preferred_username"])) {
    const wert = claims[claim];
    if (typeof wert === "string" && wert.trim()) return wert.trim();
  }
  return null;
}

function kennung(wert: unknown): string | null {
  if (typeof wert === "string" && wert !== "") return wert;
  if (typeof wert === "number" && Number.isSafeInteger(wert)) {
    return String(wert);
  }
  return null;
}

/**
 * Die Kennung aus dem signierten ID-Token, nie aus Userinfo.
 *
 * Mit `oid` nur eine GUID: `sub` von Entra ID hat eine andere Form (43
 * Zeichen base64url). So kann ein Wert aus `oid` nie mit dem `sub` einer
 * Person zusammenfallen, deren Bindung noch nicht umgestellt ist; beide
 * stehen in derselben Spalte.
 */
export function bestimmeSubject(
  idToken: Record<string, unknown>,
  claim: SubjectClaim,
): { subject: string; legacySubject: string | null } {
  const wert = kennung(idToken[claim]);
  if (!wert || wert.length > SUBJECT_MAX_LENGTH) {
    throw new Error(`ID-Token ohne ${claim}`);
  }
  if (claim === "sub") return { subject: wert, legacySubject: null };
  if (!GUID.test(wert)) {
    throw new Error(`ID-Token: ${claim} ist keine Objekt-ID (GUID)`);
  }
  const sub = kennung(idToken.sub);
  if (!sub) throw new Error("ID-Token ohne sub");
  return { subject: wert.toLowerCase(), legacySubject: sub };
}

/**
 * Liest die Angaben, auf die sich diese App stützt.
 *
 * Mit `userinfo` gelten die Regeln für ID-Token und Userinfo zusammen:
 * das ID-Token gewinnt bei jedem Claim, den es trägt; was ihm fehlt
 * (Adresse, Bestätigung, Name), kommt aus Userinfo. Die Kennung kommt
 * immer aus dem ID-Token. Ohne `regeln` gelten die Vorgaben.
 */
export function readClaims(
  idToken: Record<string, unknown>,
  o: { userinfo?: Record<string, unknown> | null; regeln?: ClaimRegeln } = {},
): OidcClaims {
  const regeln = o.regeln ?? VORGABE_REGELN;
  const quelle = o.userinfo ? { ...o.userinfo, ...idToken } : idToken;
  return {
    ...bestimmeSubject(idToken, regeln.subjectClaim),
    ...bestimmeAdresse(quelle, regeln),
    name: bestimmeName(quelle, regeln.nameClaim),
  };
}

/**
 * Entra ID ohne jede Aussage zur Adresse: ein Token eines
 * Microsoft-Ausstellers mit Adresse, aber ohne `xms_edov` und ohne
 * `email_verified`. Dann entscheidet allein die Domainliste; lib/oidc.ts
 * rät einmal je Prozess, den optionalen Claim einzurichten.
 */
export function fehltEntraBestaetigung(idToken: Record<string, unknown>): boolean {
  let host: string;
  try {
    host = new URL(String(idToken.iss)).hostname;
  } catch {
    return false;
  }
  return (
    host === "login.microsoftonline.com" &&
    idToken.email !== undefined &&
    idToken.xms_edov === undefined &&
    idToken.email_verified === undefined
  );
}

// ---------------------------------------------------------------------
// Parser der Variablen (Ergebnis<T>, Meldungen beginnen mit dem Namen)
// ---------------------------------------------------------------------

const CLAIM_NAME = /^[A-Za-z0-9_.:/-]{1,128}$/;
export const EMAIL_CLAIMS_MAX = 5;
export const TRUSTED_DOMAINS_MAX = 100;
const LDH_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Öffentliche Mail-Domains: dort kann sich jede Person eine Adresse
 * anlegen. In OIDC_TRUSTED_EMAIL_DOMAINS gäben sie jede solche Adresse
 * als bestätigt aus.
 */
const OEFFENTLICHE_MAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "gmx.de",
  "gmx.ch",
  "gmx.net",
  "web.de",
  "proton.me",
  "protonmail.com",
];

/** Kommagetrennte Einträge, getrimmt; ein leerer Eintrag ist ein Fehler. */
function eintraege(
  roh: string,
  name: string,
): Ergebnis<string[]> {
  const teile = roh.split(",").map((t) => t.trim());
  if (teile.some((t) => t === "")) {
    return { ok: false, fehler: `${name} enthält einen leeren Eintrag: "${roh}"` };
  }
  return { ok: true, wert: teile };
}

/**
 * OIDC_TRUSTED_EMAIL_DOMAINS: Domains, getrennt durch Komma und/oder
 * Leerraum, je Eintrag LDH-Labels (ein einzelnes Label ist erlaubt),
 * kein "@" und kein "*" (Subdomains stehen einzeln in der Liste),
 * höchstens 100. Internationale Namen werden in Punycode verglichen.
 */
export function parseTrustedDomains(
  roh: string | undefined,
  name = "OIDC_TRUSTED_EMAIL_DOMAINS",
): Ergebnis<string[]> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: [] };
  const teile = eintraege(text, name);
  if (!teile.ok) return teile;
  const domains = teile.wert.flatMap((t) => t.split(/\s+/));
  if (domains.length > TRUSTED_DOMAINS_MAX) {
    return {
      ok: false,
      fehler: `${name} nennt ${domains.length} Domains, erlaubt sind höchstens ${TRUSTED_DOMAINS_MAX}`,
    };
  }
  const liste: string[] = [];
  for (const d of domains) {
    if (d.includes("@")) {
      return { ok: false, fehler: `${name} erwartet Domains, keine Adressen: "${d}"` };
    }
    if (d.includes("*")) {
      return {
        ok: false,
        fehler: `${name} kennt keine Platzhalter, Subdomains einzeln eintragen: "${d}"`,
      };
    }
    const ascii = asciiDomain(d);
    const labels = ascii.split(".");
    if (
      ascii === "" ||
      ascii.length > 253 ||
      !labels.every((l) => LDH_LABEL.test(l))
    ) {
      return { ok: false, fehler: `${name}: "${d}" ist keine gültige Domain` };
    }
    if (!liste.includes(ascii)) liste.push(ascii);
  }
  const oeffentlich = liste.filter((d) => OEFFENTLICHE_MAIL_DOMAINS.includes(d));
  return {
    ok: true,
    wert: liste,
    hinweise: oeffentlich.length
      ? [
          `${name} nennt öffentliche Mail-Domains (${oeffentlich.join(", ")}): ` +
            "dort kann jede Person eine Adresse anlegen, die dann als bestätigt gilt",
        ]
      : undefined,
  };
}

/** OIDC_EMAIL_CLAIM: 1 bis 5 Claim-Namen, kommagetrennt, ohne Dubletten. */
export function parseClaimList(
  roh: string | undefined,
  name = "OIDC_EMAIL_CLAIM",
): Ergebnis<string[]> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: [...VORGABE_REGELN.emailClaims] };
  const teile = eintraege(text, name);
  if (!teile.ok) return teile;
  if (teile.wert.length > EMAIL_CLAIMS_MAX) {
    return {
      ok: false,
      fehler: `${name} nennt ${teile.wert.length} Claims, erlaubt sind höchstens ${EMAIL_CLAIMS_MAX}`,
    };
  }
  for (const claim of teile.wert) {
    if (!CLAIM_NAME.test(claim)) {
      return { ok: false, fehler: `${name}: "${claim}" ist kein gültiger Claim-Name` };
    }
  }
  const doppelt = teile.wert.find((c, i) => teile.wert.indexOf(c) !== i);
  if (doppelt) {
    return { ok: false, fehler: `${name} nennt "${doppelt}" doppelt` };
  }
  return { ok: true, wert: teile.wert };
}

/** OIDC_NAME_CLAIM: ein Claim-Name, Vorgabe `name`. */
export function parseClaimName(
  roh: string | undefined,
  name = "OIDC_NAME_CLAIM",
): Ergebnis<string> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: VORGABE_REGELN.nameClaim };
  if (!CLAIM_NAME.test(text)) {
    return { ok: false, fehler: `${name}: "${roh}" ist kein gültiger Claim-Name` };
  }
  return { ok: true, wert: text };
}

/**
 * OIDC_SUBJECT_CLAIM: nur `sub` oder `oid`. Die Kennung muss eine Person
 * dauerhaft bezeichnen; ein frei gewählter Claim könnte zudem Werte
 * liefern, die als `sub` einer anderen Person schon in der Tabelle
 * stehen.
 */
export function parseSubjectClaim(
  roh: string | undefined,
  name = "OIDC_SUBJECT_CLAIM",
): Ergebnis<SubjectClaim> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: VORGABE_REGELN.subjectClaim };
  const treffer = SUBJECT_CLAIMS.find((c) => c === text.toLowerCase());
  if (!treffer) {
    return {
      ok: false,
      fehler:
        `${name} kennt nur sub oder oid (eine unveränderliche Kennung; ` +
        `für Microsoft Entra ID oid): "${roh}"`,
    };
  }
  return { ok: true, wert: treffer };
}

/** Alle vier Einstellungen aus der Umgebung; der erste Fehler gewinnt. */
export function claimRegelnAus(env: Umgebung): Ergebnis<ClaimRegeln> {
  const domains = parseTrustedDomains(env.OIDC_TRUSTED_EMAIL_DOMAINS);
  if (!domains.ok) return domains;
  const emailClaims = parseClaimList(env.OIDC_EMAIL_CLAIM);
  if (!emailClaims.ok) return emailClaims;
  const nameClaim = parseClaimName(env.OIDC_NAME_CLAIM);
  if (!nameClaim.ok) return nameClaim;
  const subjectClaim = parseSubjectClaim(env.OIDC_SUBJECT_CLAIM);
  if (!subjectClaim.ok) return subjectClaim;
  return {
    ok: true,
    wert: {
      trustedEmailDomains: domains.wert,
      emailClaims: emailClaims.wert,
      nameClaim: nameClaim.wert,
      subjectClaim: subjectClaim.wert,
    },
  };
}
