import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { createHash } from "node:crypto";
import {
  authorizationUrl,
  discover,
  fetchUserinfo,
  meldeEntraOhneBestaetigung,
  oidcConfig,
  pkceChallenge,
  randomToken,
  readClaims,
  type OidcConfig,
} from "./oidc";
import { VORGABE_REGELN } from "./oidc-claims";
import { log } from "./log";

const config: OidcConfig = {
  ...VORGABE_REGELN,
  issuer: "https://idp.example",
  clientId: "dokunc",
  clientSecret: "geheim",
  scopes: "openid email profile",
  label: "Firmenkonto",
  allowSignup: false,
};

describe("PKCE", () => {
  it("bildet die S256-Challenge nach RFC 7636", () => {
    // Testvektor aus Anhang B der Norm.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallenge(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("hasht wirklich und gibt nicht den Verifier zurück", () => {
    const verifier = randomToken(48);
    const challenge = pkceChallenge(verifier);
    expect(challenge).not.toBe(verifier);
    expect(challenge).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
  });

  it("erzeugt jedes Mal einen anderen Wert", () => {
    const values = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(values.size).toBe(50);
  });
});

describe("Authorization-URL", () => {
  const url = new URL(
    authorizationUrl({
      config,
      endpoint: "https://idp.example/authorize?ui_locales=de",
      redirectUri: "https://wiki.example/api/auth/oidc/callback",
      state: "s-1",
      nonce: "n-1",
      codeChallenge: "c-1",
    }),
  );

  it("trägt alle Pflichtangaben", () => {
    expect(url.origin + url.pathname).toBe("https://idp.example/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("dokunc");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://wiki.example/api/auth/oidc/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("s-1");
    expect(url.searchParams.get("nonce")).toBe("n-1");
    expect(url.searchParams.get("code_challenge")).toBe("c-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("behält eigene Parameter des Anbieters", () => {
    expect(url.searchParams.get("ui_locales")).toBe("de");
  });

  it("schickt weder Secret noch Verifier zum Browser", () => {
    expect(url.toString()).not.toContain("geheim");
  });
});

describe("Claims", () => {
  it("liest Subject, Adresse und Namen", () => {
    expect(
      readClaims({
        sub: "abc",
        email: "  Alex@Team.De ",
        email_verified: true,
        name: "Alex Muster",
      }),
    ).toEqual({
      subject: "abc",
      legacySubject: null,
      email: "alex@team.de",
      emailVerified: true,
      emailSource: "email",
      verifiedBy: "email_verified",
      name: "Alex Muster",
    });
  });

  it("nimmt preferred_username, wenn kein Name kommt", () => {
    expect(readClaims({ sub: "x", preferred_username: "amuster" }).name).toBe(
      "amuster",
    );
  });

  it("gilt ohne den Claim als unbestätigt", () => {
    // Ohne ausdrückliches email_verified darf keine Verknüpfung mit
    // einem bestehenden Konto entstehen.
    expect(readClaims({ sub: "x", email: "a@b.test" }).emailVerified).toBe(
      false,
    );
    expect(
      readClaims({ sub: "x", email: "a@b.test", email_verified: "true" })
        .emailVerified,
    ).toBe(false);
  });

  it("verwirft eine Adresse, die keine ist", () => {
    expect(readClaims({ sub: "x", email: "kein-at-zeichen" }).email).toBeNull();
    expect(readClaims({ sub: "x", email: 42 }).email).toBeNull();
  });

  it("verwirft eine Adresse ohne lokalen Teil oder ohne Domain", () => {
    // Mit blossem includes("@") liefe „@" durch, wanderte als
    // eindeutiger Schlüssel in die Benutzertabelle und ergäbe beim
    // Anlegen ein Konto mit leerem Anzeigenamen.
    expect(readClaims({ sub: "x", email: "@" }).email).toBeNull();
    expect(readClaims({ sub: "x", email: "alex@" }).email).toBeNull();
    expect(readClaims({ sub: "x", email: "@team.de" }).email).toBeNull();
    expect(readClaims({ sub: "x", email: "a@b@c.de" }).email).toBeNull();
    expect(
      readClaims({ sub: "x", email: "vor name@team.de" }).email,
    ).toBeNull();
  });

  it("verwirft eine überlange Adresse", () => {
    const lang = `${"a".repeat(250)}@team.de`;
    expect(readClaims({ sub: "x", email: lang }).email).toBeNull();
  });

  it("nimmt eine Adresse ohne Punkt in der Domain", () => {
    // Im Verzeichnis eines Anbieters kommen sie vor; die Prüfung soll
    // die Form absichern, nicht enger sein als die Wirklichkeit.
    expect(readClaims({ sub: "x", email: "alex@intranet" }).email).toBe(
      "alex@intranet",
    );
  });
});

describe("Aussteller aus der Umgebung", () => {
  const vorher = { ...process.env };
  afterEach(() => {
    process.env.OIDC_ISSUER = vorher.OIDC_ISSUER;
    process.env.OIDC_CLIENT_ID = vorher.OIDC_CLIENT_ID;
  });

  const mitIssuer = (issuer: string) => {
    process.env.OIDC_ISSUER = issuer;
    process.env.OIDC_CLIENT_ID = "dokunc";
    return oidcConfig();
  };

  it("nimmt https und schneidet abschliessende Schrägstriche ab", () => {
    expect(mitIssuer("  https://idp.example/  ")?.issuer).toBe(
      "https://idp.example",
    );
  });

  it("lässt http nur auf dem eigenen Rechner zu", () => {
    expect(mitIssuer("http://localhost:8080/realms/dokunc")?.issuer).toBe(
      "http://localhost:8080/realms/dokunc",
    );
    expect(mitIssuer("http://127.0.0.1:8080")?.issuer).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("schaltet SSO bei einem http-Aussteller im Netz ab", () => {
    // Sonst gingen Discovery, JWKS und das Client-Secret unverschlüsselt
    // durchs Netz und die Signaturschlüssel wären unterwegs austauschbar.
    expect(mitIssuer("http://idp.example")).toBeNull();
  });

  it("schaltet SSO bei einem Wert ohne Schema ab", () => {
    // Früher scheiterte erst das fetch, und im Browser stand nur
    // sso=error ohne Hinweis auf die Ursache.
    expect(mitIssuer("idp.example")).toBeNull();
    expect(mitIssuer("ftp://idp.example")).toBeNull();
  });
});

describe("Einstellungen der Claims aus der Umgebung", () => {
  beforeEach(() => {
    vi.stubEnv("OIDC_ISSUER", "https://idp.example");
    vi.stubEnv("OIDC_CLIENT_ID", "dokunc");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("liest die vier Variablen", () => {
    vi.stubEnv("OIDC_TRUSTED_EMAIL_DOMAINS", "Entra.test firma.ch");
    vi.stubEnv("OIDC_EMAIL_CLAIM", "email,preferred_username");
    vi.stubEnv("OIDC_NAME_CLAIM", "given_name");
    vi.stubEnv("OIDC_SUBJECT_CLAIM", "oid");
    expect(oidcConfig()).toMatchObject({
      trustedEmailDomains: ["entra.test", "firma.ch"],
      emailClaims: ["email", "preferred_username"],
      nameClaim: "given_name",
      subjectClaim: "oid",
    });
  });

  it("ohne Werte gelten die Vorgaben", () => {
    expect(oidcConfig()).toMatchObject(VORGABE_REGELN);
  });

  it("schaltet SSO bei einem ungültigen Wert ab und meldet ihn einmal", () => {
    const fehler = vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.stubEnv("OIDC_EMAIL_CLAIM", "email;upn");
    expect(oidcConfig()).toBeNull();
    expect(oidcConfig()).toBeNull();
    const zeilen = fehler.mock.calls.filter(
      (c) => c[1] === "OIDC-Konfiguration unbrauchbar — SSO bleibt aus",
    );
    expect(zeilen).toHaveLength(1);
    expect(JSON.stringify(zeilen[0][0])).toContain("OIDC_EMAIL_CLAIM");
  });
});

/** fetch-Attrappe mit einer Antwort je Aufruf. */
function stubFetch(...antworten: Array<Response | Error>) {
  const f = vi.fn(async () => {
    const a = antworten.shift();
    if (!a) throw new Error("kein weiterer Aufruf erwartet");
    if (a instanceof Error) throw a;
    return a;
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

describe("Userinfo", () => {
  let warn: MockInstance<typeof log.warn>;
  beforeEach(() => {
    warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const holen = () =>
    fetchUserinfo("https://idp.example/userinfo", "zugang", "sub-1");
  const gewarnt = () =>
    warn.mock.calls.map((c) => String(c[c.length - 1]));

  it("liefert die Claims bei gleichem sub, mit dem Access-Token", async () => {
    const f = stubFetch(json({ sub: "sub-1", email: "a@b.test" }));
    expect(await holen()).toEqual({ sub: "sub-1", email: "a@b.test" });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer zugang",
    );
  });

  it("verwirft die Antwort zu einem anderen sub", async () => {
    stubFetch(json({ sub: "jemand-anders", email: "a@b.test" }));
    expect(await holen()).toBeNull();
    expect(gewarnt()).toContain(
      "OIDC-Userinfo gehört zu einem anderen Subject — verworfen",
    );
  });

  it("verwirft eine Antwort ohne sub", async () => {
    stubFetch(json({ email: "a@b.test" }));
    expect(await holen()).toBeNull();
  });

  it("verwirft eine Ablehnung", async () => {
    stubFetch(json({ error: "invalid_token" }, { status: 401 }));
    expect(await holen()).toBeNull();
    expect(gewarnt()).toContain("OIDC-Userinfo abgelehnt");
  });

  it("verwirft signierte Userinfo und kaputtes JSON", async () => {
    stubFetch(
      new Response("eyJ.eyJ.sig", {
        headers: { "content-type": "application/jwt" },
      }),
      new Response("{kaputt", {
        headers: { "content-type": "application/json" },
      }),
      json(["liste"]),
    );
    expect(await holen()).toBeNull();
    expect(await holen()).toBeNull();
    expect(await holen()).toBeNull();
    expect(gewarnt().filter((m) => m === "OIDC-Userinfo nicht als JSON")).toHaveLength(3);
  });

  it("wirft nicht, wenn der Anbieter nicht antwortet", async () => {
    stubFetch(new DOMException("Zeit abgelaufen", "TimeoutError"));
    expect(await holen()).toBeNull();
    expect(gewarnt()).toContain("OIDC-Userinfo nicht erreichbar");
  });
});

describe("Discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function dokument(issuer: string) {
    return json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    });
  }

  it("lehnt die Multi-Tenant-Endpunkte von Microsoft mit klarer Meldung ab", async () => {
    const f = stubFetch();
    for (const tenant of ["common", "organizations", "consumers", "Common"]) {
      await expect(
        discover({
          ...config,
          issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        }),
      ).rejects.toThrow(/Multi-Tenant-Endpunkt von Microsoft/);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("erkennt die Vorlage {tenantid} im Dokument", async () => {
    const issuer = "https://login.example-proxy.test/v2.0";
    stubFetch(dokument("https://login.microsoftonline.com/{tenantid}/v2.0"));
    await expect(discover({ ...config, issuer })).rejects.toThrow(
      /Multi-Tenant-Endpunkt von Microsoft/,
    );
  });

  it("merkt sich das Dokument je Aussteller", async () => {
    const f = stubFetch(
      dokument("https://eins.test"),
      dokument("https://zwei.test"),
    );
    expect((await discover({ ...config, issuer: "https://eins.test" })).issuer).toBe(
      "https://eins.test",
    );
    expect((await discover({ ...config, issuer: "https://eins.test" })).issuer).toBe(
      "https://eins.test",
    );
    expect((await discover({ ...config, issuer: "https://zwei.test" })).issuer).toBe(
      "https://zwei.test",
    );
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("Hinweis zu Entra ID ohne xms_edov", () => {
  it("steht einmal je Prozess im Log", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const token = {
      iss: "https://login.microsoftonline.com/9122040d-6c67-4c5b-b112-36a304b66dad/v2.0",
      sub: "x",
      email: "a@entra.test",
    };
    meldeEntraOhneBestaetigung({ ...token, xms_edov: true });
    expect(warn).not.toHaveBeenCalled();
    meldeEntraOhneBestaetigung(token);
    meldeEntraOhneBestaetigung(token);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toMatch(/xms_edov/);
    warn.mockRestore();
  });
});
