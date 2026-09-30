import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@dokunc/db";

/**
 * Suchparameter, die die App nie erzeugt, von aussen aber jede Person in
 * die Adresse schreiben kann: mehrfach angegeben (?token=a&token=b, Next
 * liefert dann eine Liste), mit NUL-Zeichen (?q=%00) oder mit einer
 * Seitenzahl, die kein OFFSET mehr ist (?p=1e300), oder mit einem
 * Schluessel, den jedes Objekt erbt (?sso=__proto__, ?action=toString).
 * Jede Seite antwortet darauf wie ohne den Parameter, eine Seite mit
 * Token mit ihrer Absage, nie mit einem Serverfehler.
 *
 * Die Freigabeseite prueft share-access.test.ts.
 */

type Actor = { id: string; email: string; name: string; isAdmin: boolean };

const mocks = vi.hoisted(() => {
  class Umleitung extends Error {
    readonly url: string;
    constructor(url: string) {
      super(`Umleitung nach ${url}`);
      this.url = url;
    }
  }
  return { actor: null as Actor | null, Umleitung };
});

vi.mock("@/lib/current-user", () => ({
  getCurrentUser: vi.fn(async () => mocks.actor),
  requireUser: vi.fn(async () => {
    if (!mocks.actor) throw new mocks.Umleitung("/login");
    return mocks.actor;
  }),
  requireAdmin: vi.fn(async () => {
    if (!mocks.actor) throw new mocks.Umleitung("/login");
    if (!mocks.actor.isAdmin) throw new mocks.Umleitung("/spaces");
    return mocks.actor;
  }),
}));
// Anmelde- und Registrierungsseite fragen den Host der Anfrage (die
// Ersteinrichtung ohne Token gibt es nur auf localhost). Die Anmeldeseite
// fragt ausserdem, ob noch ein Sitzungs-Cookie da ist (hasSessionCookie):
// hier nie. Ausserhalb einer Anfrage werfen headers() und cookies(); die
// anderen Seiten hier lesen beides nicht.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
  cookies: vi.fn(async () => ({ has: () => false, get: () => undefined })),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));

const { default: InvitePage } = await import("@/app/(auth)/invite/[id]/page");
const { default: ResetPage } = await import("@/app/(auth)/reset/[id]/page");
const { default: LoginPage } = await import("@/app/(auth)/login/page");
const { default: RegisterPage } = await import("@/app/(auth)/register/page");
const { default: SearchPage } = await import("@/app/s/[slug]/search/page");
const { default: AuditPage } = await import("@/app/admin/audit/page");
const { GET: searchGet } = await import("@/app/api/search/route");
const { generateInviteToken } = await import("@/lib/invitations");
const { resetLimit } = await import("@/lib/rate-limit");
const { renderToStaticMarkup } = await import("react-dom/server");

const TAG = `sprm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** Ein Wort, das nur diese Datei in einen Titel schreibt. */
const WORT = `Suchprobe${randomBytes(6).toString("hex").replace(/\d/g, "x")}`;

type Query = Record<string, string | string[] | undefined>;

let actor: Actor;
let spaceId: string;
let slug: string;
let invitationId: string;
let inviteToken: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: "Suchparameter", passwordHash: "x" },
    select: { id: true, email: true, name: true, isAdmin: true },
  });
  actor = user;
  slug = TAG;
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug,
        members: { create: [{ userId: user.id, role: "OWNER" }] },
      },
      select: { id: true },
    })
  ).id;
  await prisma.page.create({ data: { spaceId, title: `${WORT} Titel` } });
  // Eine eigene Zeile im Audit-Log, am Ziel erkennbar (afterAll loescht
  // alle Zeilen dieses Kontos).
  await prisma.auditLog.create({
    data: { action: "auth.registered", actorId: user.id, targetId: `${TAG}-audit` },
  });
  const { token, tokenHash } = generateInviteToken();
  inviteToken = token;
  invitationId = (
    await prisma.spaceInvitation.create({
      data: {
        spaceId,
        email: `gast-${TAG}@example.test`,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  if (actor) {
    await resetLimit(`search:${actor.id}`);
    await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
  }
  // Einladungen und Seiten haengen am Space (Cascade).
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  if (actor) await prisma.user.deleteMany({ where: { id: actor.id } });
});

async function zeige(
  seite: (props: never) => Promise<React.ReactElement>,
  searchParams: Query,
  params: Record<string, string> = {},
): Promise<string> {
  const el = await (seite as (p: unknown) => Promise<React.ReactElement>)({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(el);
}

describe("Einladung", () => {
  const einladung = (sp: Query) => zeige(InvitePage, sp, { id: invitationId });

  it("oeffnet mit dem Token (Positivkontrolle)", async () => {
    mocks.actor = null;
    expect(await einladung({ token: inviteToken })).toContain("Du wurdest eingeladen");
  });

  it("gibt bei doppeltem Token dieselbe Absage wie bei einem falschen", async () => {
    mocks.actor = null;
    const falsch = await einladung({ token: "falsch" });
    expect(falsch).toContain("Einladung ungültig");
    // Vorher: hashToken warf bei der Liste, 500 und ein Fehlerlog, und
    // zwar nur bei einer offenen Einladung (die Antwort verriet das).
    expect(await einladung({ token: [inviteToken, inviteToken] })).toBe(falsch);
    expect(await einladung({ token: [inviteToken, "x"] })).toBe(falsch);
  });
});

describe("Passwort zuruecksetzen", () => {
  const tokenFeld = async (sp: Query) => {
    const html = await zeige(ResetPage, sp, { id: "r1" });
    return html.match(/<input type="hidden" name="token" value="([^"]*)"/)?.[1];
  };

  it("uebernimmt ein einzelnes Token ins Formular (Positivkontrolle)", async () => {
    expect(await tokenFeld({ token: "abc" })).toBe("abc");
  });

  it("verbindet ein doppeltes Token nicht zu a,b", async () => {
    // Das Formular meldet beim Absenden "Link ungültig", wie ohne Token.
    expect(await tokenFeld({ token: ["abc", "def"] })).toBe("");
    expect(await tokenFeld({})).toBe("");
  });
});

describe("Anmelden und Registrieren", () => {
  const nextFeld = (html: string) =>
    html.match(/<input type="hidden" name="next" value="([^"]*)"/)?.[1];

  it("reichen ein einzelnes Ziel weiter (Positivkontrolle)", async () => {
    expect(nextFeld(await zeige(LoginPage, { next: "/s/x" }))).toBe("/s/x");
    expect(nextFeld(await zeige(RegisterPage, { next: "/s/x" }))).toBe("/s/x");
  });

  it("lassen ein doppeltes Ziel weg statt /a,/b", async () => {
    expect(nextFeld(await zeige(LoginPage, { next: ["/a", "/b"] }))).toBeUndefined();
    expect(nextFeld(await zeige(RegisterPage, { next: ["/a", "/b"] }))).toBeUndefined();
  });

  it("zeigt nur bekannte SSO-Hinweise, unbekannte Kennungen ohne Fehler", async () => {
    // Positivkontrolle: eine bekannte Kennung erscheint als Fehlerbox.
    const bekannt = await zeige(LoginPage, { sso: "state" });
    expect(bekannt).toContain("Der Anmeldevorgang passt nicht zusammen");
    expect(bekannt).toContain("dk-shake");
    // Vorher fand SSO_ERRORS["__proto__"] Object.prototype, React warf
    // beim Rendern ("Objects are not valid as a React child"): 500.
    for (const sso of ["__proto__", "constructor", "toString", ["state", "state"]]) {
      const html = await zeige(LoginPage, { sso });
      expect(html, String(sso)).toContain("Willkommen zurück");
      expect(html, String(sso)).not.toContain("dk-shake");
    }
  });
});

describe("Audit-Log", () => {
  const audit = (sp: Query) => {
    mocks.actor = { ...actor, isAdmin: true };
    return zeige(AuditPage, sp);
  };

  it("zeigt bei einem Prototyp-Schluessel als Filter alle Ereignisse", async () => {
    // Positivkontrolle: ohne Filter steht die eigene Zeile in der Liste.
    const alle = await audit({});
    expect(alle).toContain(`${TAG}-audit`);
    // Vorher sah `in` auch "__proto__" und filterte auf ein Ereignis, das
    // es nie gibt: "Noch keine Ereignisse" bei vollem Log.
    for (const action of ["__proto__", "constructor", "toString", ["auth.registered", "x"]]) {
      const html = await audit({ action });
      expect(html, String(action)).toContain(`${TAG}-audit`);
      expect(html, String(action)).not.toContain("Noch keine Ereignisse");
    }
  });
});

describe("Suche im Space", () => {
  const suche = (sp: Query) => {
    mocks.actor = actor;
    return zeige(SearchPage, sp, { slug });
  };

  it("findet die Probeseite (Positivkontrolle)", async () => {
    expect(await suche({ q: WORT })).toContain(`${WORT} Titel`);
  });

  it("zeigt bei doppeltem q die leere Suche statt eines Fehlers", async () => {
    const html = await suche({ q: [WORT, WORT] });
    expect(html).toContain('aria-label="Suchbegriff"');
    expect(html).not.toContain(`${WORT} Titel`);
  });

  it("sucht mit NUL-Zeichen im Begriff ohne sie", async () => {
    const mitNul = `${WORT.slice(0, 4)}\0${WORT.slice(4)}`;
    expect(await suche({ q: mitNul })).toContain(`${WORT} Titel`);
  });

  it("zeigt bei unbrauchbarer Seitenzahl die erste Seite", async () => {
    for (const p of ["1e300", "Infinity", ["2", "3"]]) {
      const html = await suche({ q: WORT, p });
      expect(html, String(p)).toContain(`${WORT} Titel`);
      expect(html, String(p)).not.toContain(">Seite ");
    }
  });
});

describe("Such-Route der Palette", () => {
  it("antwortet auf NUL-Zeichen im Begriff mit Treffern statt 500", async () => {
    mocks.actor = actor;
    const frage = async (q: string) => {
      const res = await searchGet(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`),
      );
      return { status: res.status, body: (await res.json()) as { pages?: { title: string }[] } };
    };
    const normal = await frage(WORT);
    expect(normal.status).toBe(200);
    expect(normal.body.pages?.map((p) => p.title)).toContain(`${WORT} Titel`);
    const mitNul = await frage(`${WORT.slice(0, 4)}\0${WORT.slice(4)}`);
    expect(mitNul.status).toBe(200);
    expect(mitNul.body.pages?.map((p) => p.title)).toContain(`${WORT} Titel`);
  });
});
