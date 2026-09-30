import { describe, expect, it } from "vitest";
import {
  VORGABE_REGELN,
  brauchtUserinfo,
  claimRegelnAus,
  fehltEntraBestaetigung,
  parseClaimList,
  parseClaimName,
  parseSubjectClaim,
  parseTrustedDomains,
  readClaims,
  type ClaimRegeln,
} from "./oidc-claims";
import { IDP_FAELLE, testIdpKonten } from "../../test/oidc-faelle";

/**
 * Regeln der SSO-Anmeldung ohne Netz. Die Matrix wendet sie auf die
 * aufgezeichneten Claim-Formate des Test-IdP an, mit denselben Faellen,
 * die oidc-idp.test.ts ueber das echte Protokoll faehrt. Userinfo kommt
 * dazu, wenn die Anmeldung sie fragen wuerde (brauchtUserinfo).
 */

const ISS = "https://idp.test";
const konten = testIdpKonten();

function regeln(over: Partial<ClaimRegeln> = {}): ClaimRegeln {
  return { ...VORGABE_REGELN, ...over };
}

describe("Matrix über die Konten des Test-IdP", () => {
  for (const fall of IDP_FAELLE) {
    it(fall.name, () => {
      const konto = konten[fall.konto];
      const sub = `sub-${fall.konto}`;
      const idToken = { iss: ISS, sub, ...konto.id_token };
      const userinfo = { sub, ...konto.userinfo };
      const r = claimRegelnAus(fall.umgebung ?? {});
      if (!r.ok) throw new Error(r.fehler);
      const claims = brauchtUserinfo(idToken, r.wert)
        ? readClaims(idToken, { userinfo, regeln: r.wert })
        : readClaims(idToken, { regeln: r.wert });
      expect(claims).toMatchObject({ subject: sub, ...fall.erwartet(sub) });
    });
  }
});

describe("Bestätigung der Adresse", () => {
  const vertraut = regeln({ trustedEmailDomains: ["entra.test"] });

  it("ein ausdrückliches Nein schlägt die vertraute Domain", () => {
    for (const nein of [false, "false"]) {
      expect(
        readClaims(
          { sub: "x", email: "a@entra.test", email_verified: nein },
          { regeln: vertraut },
        ),
      ).toMatchObject({ emailVerified: false, verifiedBy: null });
    }
    expect(
      readClaims(
        { sub: "x", email: "a@entra.test", xms_edov: false },
        { regeln: vertraut },
      ),
    ).toMatchObject({ emailVerified: false, verifiedBy: null });
  });

  it("email_verified geht xms_edov vor", () => {
    expect(
      readClaims({
        sub: "x",
        email: "a@b.test",
        email_verified: true,
        xms_edov: false,
      }),
    ).toMatchObject({ emailVerified: true, verifiedBy: "email_verified" });
  });

  it('der Text "true" bestätigt nichts, die Domain entscheidet', () => {
    expect(
      readClaims({ sub: "x", email: "a@entra.test", email_verified: "true" }),
    ).toMatchObject({ emailVerified: false, verifiedBy: null });
    expect(
      readClaims(
        { sub: "x", email: "a@entra.test", email_verified: "true" },
        { regeln: vertraut },
      ),
    ).toMatchObject({ emailVerified: true, verifiedBy: "domain" });
  });

  it("vergleicht Domains klein geschrieben und in Punycode", () => {
    expect(
      readClaims({ sub: "x", email: "a@ENTRA.test" }, { regeln: vertraut }),
    ).toMatchObject({ email: "a@entra.test", verifiedBy: "domain" });

    const idn = parseTrustedDomains("bücher.test");
    expect(idn).toEqual({ ok: true, wert: ["xn--bcher-kva.test"] });
    if (!idn.ok) return;
    const r = regeln({ trustedEmailDomains: idn.wert });
    expect(readClaims({ sub: "x", email: "kim@bücher.test" }, { regeln: r }))
      .toMatchObject({ emailVerified: true, verifiedBy: "domain" });
    expect(
      readClaims({ sub: "x", email: "kim@xn--bcher-kva.test" }, { regeln: r }),
    ).toMatchObject({ emailVerified: true, verifiedBy: "domain" });
  });

  it("Subdomains zählen nicht mit", () => {
    expect(
      readClaims({ sub: "x", email: "a@sub.entra.test" }, { regeln: vertraut }),
    ).toMatchObject({ emailVerified: false });
  });

  it("die Domainregel gilt nicht für Gäste aus einem anderen Verzeichnis", () => {
    const gast = {
      sub: "x",
      iss: "https://login.microsoftonline.com/t/v2.0",
      email: "a@entra.test",
    };
    expect(
      readClaims(
        { ...gast, idp: "https://sts.windows.net/anderer/" },
        { regeln: vertraut },
      ),
    ).toMatchObject({ emailVerified: false, verifiedBy: null });
    // Ohne idp oder mit idp gleich dem Aussteller: ein Mitglied.
    expect(readClaims(gast, { regeln: vertraut })).toMatchObject({
      emailVerified: true,
      verifiedBy: "domain",
    });
    expect(
      readClaims({ ...gast, idp: gast.iss }, { regeln: vertraut }),
    ).toMatchObject({ emailVerified: true, verifiedBy: "domain" });
  });

  it("nimmt für Gäste auch keinen anderen Claim über die Domain", () => {
    const r = regeln({
      trustedEmailDomains: ["entra.test"],
      emailClaims: ["email", "upn"],
    });
    expect(
      readClaims(
        {
          sub: "x",
          iss: "https://login.microsoftonline.com/t/v2.0",
          idp: "https://sts.windows.net/anderer/",
          upn: "a@entra.test",
        },
        { regeln: r },
      ),
    ).toMatchObject({ email: null });
  });

  it("Userinfo kommt nur dazu, wenn Adresse oder Aussage fehlen", () => {
    expect(brauchtUserinfo({ sub: "x" }, VORGABE_REGELN)).toBe(true);
    expect(brauchtUserinfo({ sub: "x", email: "a@b.test" }, VORGABE_REGELN))
      .toBe(true);
    for (const aussage of [
      { email_verified: true },
      { email_verified: false },
      { xms_edov: true },
      { xms_edov: false },
    ]) {
      expect(
        brauchtUserinfo({ sub: "x", email: "a@b.test", ...aussage }, VORGABE_REGELN),
      ).toBe(false);
    }
    // Adresse aus einem anderen Claim, über die Domain bestätigt.
    expect(
      brauchtUserinfo(
        { sub: "x", upn: "a@entra.test" },
        regeln({ emailClaims: ["email", "upn"], trustedEmailDomains: ["entra.test"] }),
      ),
    ).toBe(false);
  });

  it("das ID-Token gewinnt vor Userinfo", () => {
    const claims = readClaims(
      { sub: "x", email: "id@b.test", name: "Aus dem Token" },
      {
        userinfo: {
          sub: "x",
          email: "info@b.test",
          email_verified: true,
          name: "Aus Userinfo",
        },
      },
    );
    expect(claims).toMatchObject({
      email: "id@b.test",
      emailVerified: true,
      verifiedBy: "email_verified",
      name: "Aus dem Token",
    });
  });
});

describe("Name", () => {
  const quelle = {
    sub: "x",
    given_name: "Alex",
    name: "Alex Muster",
    preferred_username: "amuster",
  };

  it("eigener Claim, dann name, dann preferred_username", () => {
    const mit = (nameClaim: string, claims: Record<string, unknown>) =>
      readClaims(claims, { regeln: regeln({ nameClaim }) }).name;
    expect(mit("given_name", quelle)).toBe("Alex");
    expect(mit("given_name", { ...quelle, given_name: "  " })).toBe("Alex Muster");
    expect(mit("given_name", { sub: "x", preferred_username: " amuster " })).toBe(
      "amuster",
    );
    expect(mit("name", { sub: "x" })).toBeNull();
  });
});

describe("Subject", () => {
  const oid = regeln({ subjectClaim: "oid" });
  const GUID = "3F2C9B1E-5A7D-4E8F-9C0B-1D2E3F4A5B6C";

  it("nimmt sub als Text oder ganze Zahl", () => {
    expect(readClaims({ sub: 12345 })).toMatchObject({
      subject: "12345",
      legacySubject: null,
    });
    expect(readClaims({ sub: "abc" }).subject).toBe("abc");
  });

  it("scheitert ohne Kennung oder mit einer überlangen", () => {
    expect(() => readClaims({})).toThrow("ID-Token ohne sub");
    expect(() => readClaims({ sub: "" })).toThrow("ID-Token ohne sub");
    expect(() => readClaims({ sub: "a".repeat(256) })).toThrow(
      "ID-Token ohne sub",
    );
    expect(readClaims({ sub: "a".repeat(255) }).subject).toHaveLength(255);
    expect(() => readClaims({ sub: "x" }, { regeln: oid })).toThrow(
      "ID-Token ohne oid",
    );
  });

  it("mit oid: Objekt-ID klein geschrieben, sub als bisherige Bindung", () => {
    expect(readClaims({ sub: "paarweise", oid: GUID }, { regeln: oid })).toMatchObject({
      subject: GUID.toLowerCase(),
      legacySubject: "paarweise",
    });
  });

  it("mit oid nur eine GUID: ein Wert in Form eines sub trifft kein altes Konto", () => {
    // Stünde hier jeder Wert, könnte eine Kennung wie "42" mit dem noch
    // nicht umgestellten sub einer anderen Person zusammenfallen.
    for (const wert of ["42", 42, "Qc1MfcabWEYwqbqML8dxSPDkxU7WOxSmL1veKrfWk50"]) {
      expect(() => readClaims({ sub: "b", oid: wert }, { regeln: oid })).toThrow(
        /oid/,
      );
    }
  });

  it("liest die Kennung nie aus Userinfo", () => {
    expect(() =>
      readClaims({ sub: "x" }, { userinfo: { sub: "x", oid: GUID }, regeln: oid }),
    ).toThrow("ID-Token ohne oid");
  });
});

describe("Hinweis für Entra ID ohne Aussage zur Adresse", () => {
  const entra = {
    iss: "https://login.microsoftonline.com/9122040d-6c67-4c5b-b112-36a304b66dad/v2.0",
    sub: "x",
    email: "a@entra.test",
  };

  it("trifft ein Entra-Token mit Adresse ohne xms_edov und email_verified", () => {
    expect(fehltEntraBestaetigung(entra)).toBe(true);
    expect(fehltEntraBestaetigung({ ...entra, xms_edov: true })).toBe(false);
    expect(fehltEntraBestaetigung({ ...entra, email_verified: false })).toBe(false);
    expect(fehltEntraBestaetigung({ ...entra, email: undefined })).toBe(false);
    expect(fehltEntraBestaetigung({ ...entra, iss: "https://idp.test" })).toBe(false);
    expect(fehltEntraBestaetigung({ ...entra, iss: 42 })).toBe(false);
  });
});

describe("Parser der Variablen", () => {
  it("OIDC_TRUSTED_EMAIL_DOMAINS: Komma und Leerraum trennen, leer ist keine Domain", () => {
    expect(parseTrustedDomains(undefined)).toEqual({ ok: true, wert: [] });
    expect(parseTrustedDomains("  ")).toEqual({ ok: true, wert: [] });
    expect(parseTrustedDomains("Entra.test, firma.ch intranet")).toEqual({
      ok: true,
      wert: ["entra.test", "firma.ch", "intranet"],
    });
    expect(parseTrustedDomains("a.test a.test")).toEqual({
      ok: true,
      wert: ["a.test"],
    });
  });

  it("OIDC_TRUSTED_EMAIL_DOMAINS: lehnt Adressen, Platzhalter und Unsinn ab", () => {
    for (const roh of [
      "@entra.test",
      "alex@entra.test",
      "*.entra.test",
      "entra.test,,firma.ch",
      "entra.test,",
      "-entra.test",
      "entra_test.ch",
      "entra..test",
      `${"a".repeat(64)}.test`,
      Array.from({ length: 101 }, (_, i) => `d${i}.test`).join(","),
    ]) {
      const r = parseTrustedDomains(roh);
      expect(r.ok, roh).toBe(false);
      if (!r.ok) expect(r.fehler).toMatch(/^OIDC_TRUSTED_EMAIL_DOMAINS/);
    }
    expect(
      parseTrustedDomains(Array.from({ length: 100 }, (_, i) => `d${i}.test`).join(","))
        .ok,
    ).toBe(true);
  });

  it("OIDC_TRUSTED_EMAIL_DOMAINS: warnt bei öffentlichen Mail-Domains", () => {
    const r = parseTrustedDomains("firma.ch, GMAIL.com");
    expect(r.ok && r.hinweise?.[0]).toMatch(/öffentliche Mail-Domains \(gmail\.com\)/);
    const ohne = parseTrustedDomains("firma.ch");
    expect(ohne.ok && ohne.hinweise).toBeUndefined();
  });

  it("OIDC_EMAIL_CLAIM: Liste mit Vorgabe email, ohne Dubletten und Leereinträge", () => {
    expect(parseClaimList(undefined)).toEqual({ ok: true, wert: ["email"] });
    expect(parseClaimList(" email , preferred_username ")).toEqual({
      ok: true,
      wert: ["email", "preferred_username"],
    });
    for (const roh of [
      "email,email",
      "email,,upn",
      "a b",
      "email;upn",
      "a,b,c,d,e,f",
      "x".repeat(129),
    ]) {
      const r = parseClaimList(roh);
      expect(r.ok, roh).toBe(false);
      if (!r.ok) expect(r.fehler).toMatch(/^OIDC_EMAIL_CLAIM/);
    }
    expect(parseClaimList("a,b,c,d,e").ok).toBe(true);
    expect(parseClaimList("https://claims.test/mail").ok).toBe(true);
  });

  it("OIDC_NAME_CLAIM: ein Claim-Name", () => {
    expect(parseClaimName("")).toEqual({ ok: true, wert: "name" });
    expect(parseClaimName(" given_name ")).toEqual({ ok: true, wert: "given_name" });
    const r = parseClaimName("given name");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler).toMatch(/^OIDC_NAME_CLAIM/);
  });

  it("OIDC_SUBJECT_CLAIM: nur sub oder oid", () => {
    expect(parseSubjectClaim(undefined)).toEqual({ ok: true, wert: "sub" });
    expect(parseSubjectClaim(" OID ")).toEqual({ ok: true, wert: "oid" });
    for (const roh of ["email", "preferred_username", "upn", "employee_id", "sub,oid"]) {
      const r = parseSubjectClaim(roh);
      expect(r.ok, roh).toBe(false);
      if (!r.ok) expect(r.fehler).toMatch(/^OIDC_SUBJECT_CLAIM kennt nur sub oder oid/);
    }
  });

  it("claimRegelnAus: alle vier, der erste Fehler gewinnt", () => {
    expect(claimRegelnAus({})).toEqual({ ok: true, wert: VORGABE_REGELN });
    expect(
      claimRegelnAus({ OIDC_EMAIL_CLAIM: "email;upn", OIDC_SUBJECT_CLAIM: "email" }),
    ).toMatchObject({ ok: false, fehler: expect.stringMatching(/^OIDC_EMAIL_CLAIM/) });
  });
});
