import { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { prisma, type SpaceRole } from "@dokunc/db";
import { appUrl } from "@dokunc/mail";

/**
 * Einladen ohne Mailserver: statt "gesendet" bekommt die einladende
 * Person den Link zur Weitergabe von Hand, sofern sie ihn nach
 * INVITE_LINK_WITHOUT_MAIL sehen darf (Vorgabe: nur Admin-Personen der
 * Instanz). Der Link ist ein Geheimnis: nie im Log der Produktion, nie im
 * Audit.
 *
 * Echte Datenbank, echtes Redis (Bremse), echtes lib/mail.ts mit
 * logMissingSmtp und buildInviteUrl. Ersetzt sind nur Anmeldung, Cache,
 * Anfrage-Header und der SMTP-Transport (sendMail), gesteuert ueber
 * mocks.smtp.
 */

type Actor = { id: string; email: string; name: string; isAdmin: boolean };

const mocks = vi.hoisted(() => ({
  actor: null as Actor | null,
  /** Was der SMTP-Transport tut. */
  smtp: "fehlt" as "fehlt" | "ok" | "wirft",
}));

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => mocks.actor),
  getCurrentUser: vi.fn(async () => mocks.actor),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@dokunc/mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dokunc/mail")>()),
  sendMail: vi.fn(async () => {
    if (mocks.smtp === "wirft") {
      throw Object.assign(new Error("Verbindung abgelehnt"), {
        code: "ECONNECTION",
      });
    }
    return mocks.smtp === "ok";
  }),
}));

const { inviteMemberAction } = await import("@/app/s/[slug]/members/actions");
const { log } = await import("@/lib/log");
const { verifyToken } = await import("@/lib/invitations");

const TAG = `invl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const spaceIds: string[] = [];
const userIds: string[] = [];
let redis: Redis;

const STUFEN = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
type Stufe = (typeof STUFEN)[number];
let spione: Record<Stufe, MockInstance<typeof log.warn>>;

const TRANSPORT_FEHLER =
  "Einladung gespeichert, aber E-Mail-Versand fehlgeschlagen. SMTP prüfen.";
const BISHERIGE_GILT =
  "E-Mail-Versand fehlgeschlagen. SMTP prüfen — die bisherige Einladung bleibt gültig.";

/** Legt eine Person mit dieser Rolle in einem neuen Space an; sie handelt. */
async function spaceMit(
  rolle: SpaceRole,
  { isAdmin }: { isAdmin: boolean },
): Promise<{ id: string; slug: string }> {
  const n = spaceIds.length;
  const person = await prisma.user.create({
    data: {
      email: `${TAG}-akteur-${n}@example.test`,
      name: `Akteur ${n}`,
      passwordHash: "x",
      isAdmin,
    },
    select: { id: true, email: true, name: true, isAdmin: true },
  });
  userIds.push(person.id);
  mocks.actor = person;
  const space = await prisma.space.create({
    data: {
      name: `${TAG}-${n}`,
      slug: `${TAG}-${n}`,
      members: { create: [{ userId: person.id, role: rolle }] },
    },
    select: { id: true, slug: true },
  });
  spaceIds.push(space.id);
  return space;
}

function formular(slug: string, email: string, role = "MEMBER"): FormData {
  const f = new FormData();
  f.set("slug", slug);
  f.set("email", email);
  f.set("role", role);
  return f;
}

function tokenAus(url: string): string {
  const t = new URL(url).searchParams.get("token");
  if (!t) throw new Error(`kein Token in ${url}`);
  return t;
}

function idAus(url: string): string {
  return new URL(url).pathname.split("/").pop()!;
}

/** Alles, was auf irgendeiner Stufe ins Log ging, als ein Text. */
function allesGeloggt(): string {
  return JSON.stringify(STUFEN.map((s) => spione[s].mock.calls));
}

let adressNr = 0;
function adresse(): string {
  adressNr += 1;
  return `${TAG}-gast-${adressNr}@example.test`;
}

async function tokenHash(id: string): Promise<string> {
  const row = await prisma.spaceInvitation.findUniqueOrThrow({
    where: { id },
    select: { tokenHash: true },
  });
  return row.tokenHash;
}

async function einladungsAudit(id: string) {
  return prisma.auditLog.findMany({
    where: { action: "member.invited", targetId: id },
    select: { metadata: true },
  });
}

beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 1,
  });
});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("INVITE_LINK_WITHOUT_MAIL", "");
  const neu: Partial<typeof spione> = {};
  for (const s of STUFEN) {
    neu[s] = vi.spyOn(log, s).mockImplementation(() => undefined);
  }
  spione = neu as typeof spione;
  mocks.smtp = "fehlt";
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const s of STUFEN) spione[s].mockRestore();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { spaceId: { in: spaceIds } },
        { actor: { email: { startsWith: TAG } } },
      ],
    },
  });
  await prisma.spaceInvitation.deleteMany({
    where: { spaceId: { in: spaceIds } },
  });
  await prisma.space.deleteMany({ where: { id: { in: spaceIds } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  if (userIds.length) {
    await redis.del(...userIds.map((id) => `dokunc:rl:invite:${id}`));
  }
  redis.disconnect();
});

describe("inviteMemberAction ohne Mailserver", () => {
  it("zeigt einer Admin-Person den Link statt 'gesendet'", async () => {
    const space = await spaceMit("OWNER", { isAdmin: true });
    const email = adresse();
    const state = await inviteMemberAction(
      undefined,
      formular(space.slug, email.toUpperCase()),
    );

    const url = state?.link?.url ?? "";
    expect(url.startsWith(`${appUrl()}/invite/`)).toBe(true);
    expect(state?.link?.email).toBe(email);
    expect(state?.success).toBeDefined();
    expect(state?.success).not.toContain("gesendet");
    expect(state?.error).toBeUndefined();

    const id = idAus(url);
    const token = tokenAus(url);
    expect(verifyToken(token, await tokenHash(id))).toBe(true);

    // Der Token steht nirgends im Log; die bestehende Warnung mit dem Pfad
    // zeigt, dass die Spione greifen.
    expect(allesGeloggt()).not.toContain(token);
    expect(spione.warn).toHaveBeenCalledWith(
      { link: `/invite/${id}` },
      expect.any(String),
    );

    const eintraege = await einladungsAudit(id);
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].metadata).toEqual({
      email,
      role: "MEMBER",
      delivery: "link",
    });
    expect(JSON.stringify(eintraege)).not.toContain(token);
  });

  it("meldet mit SMTP 'gesendet' und zeigt keinen Link", async () => {
    const space = await spaceMit("OWNER", { isAdmin: true });
    const email = adresse();
    mocks.smtp = "ok";
    const state = await inviteMemberAction(undefined, formular(space.slug, email));

    expect(state).toEqual({ success: `Einladung an ${email} gesendet.` });
    const row = await prisma.spaceInvitation.findUniqueOrThrow({
      where: { spaceId_email: { spaceId: space.id, email } },
      select: { id: true },
    });
    const eintraege = await einladungsAudit(row.id);
    expect(eintraege.map((e) => e.metadata)).toEqual([
      { email, role: "MEMBER", delivery: "mail" },
    ]);
  });

  it("gibt bei einem Transportfehler ohne fruehere Einladung den Link", async () => {
    const space = await spaceMit("OWNER", { isAdmin: true });
    const email = adresse();
    mocks.smtp = "wirft";
    const state = await inviteMemberAction(undefined, formular(space.slug, email));

    expect(state?.error).toBe(TRANSPORT_FEHLER);
    const url = state?.link?.url ?? "";
    const id = idAus(url);
    const token = tokenAus(url);
    expect(verifyToken(token, await tokenHash(id))).toBe(true);

    expect(allesGeloggt()).not.toContain(token);
    expect(spione.error).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: id }),
      "Einladungsmail konnte nicht gesendet werden",
    );
    expect((await einladungsAudit(id)).map((e) => e.metadata)).toEqual([
      { email, role: "MEMBER", delivery: "link" },
    ]);
  });

  it("laesst bei einem Transportfehler eine gueltige fruehere Einladung stehen", async () => {
    const space = await spaceMit("OWNER", { isAdmin: true });
    const email = adresse();
    const erste = await inviteMemberAction(undefined, formular(space.slug, email));
    const link1 = erste?.link?.url ?? "";
    expect(link1).not.toBe("");

    mocks.smtp = "wirft";
    const state = await inviteMemberAction(undefined, formular(space.slug, email));

    expect(state).toEqual({ error: BISHERIGE_GILT });
    expect(verifyToken(tokenAus(link1), await tokenHash(idAus(link1)))).toBe(
      true,
    );
    // Nur der Eintrag der ersten Einladung.
    expect(await einladungsAudit(idAus(link1))).toHaveLength(1);
  });

  it.each([
    ["angenommen", { acceptedAt: new Date() }],
    ["abgelaufen", { expiresAt: new Date(Date.now() - 60_000) }],
  ] as const)(
    "behandelt eine fruehere Einladung, die %s ist, wie keine",
    async (_fall, alt) => {
      const space = await spaceMit("OWNER", { isAdmin: true });
      const email = adresse();
      const erste = await inviteMemberAction(
        undefined,
        formular(space.slug, email),
      );
      const id = idAus(erste?.link?.url ?? "");
      await prisma.spaceInvitation.update({ where: { id }, data: alt });

      mocks.smtp = "wirft";
      const vorher = Date.now();
      const state = await inviteMemberAction(
        undefined,
        formular(space.slug, email),
      );

      expect(state?.error).toBe(TRANSPORT_FEHLER);
      const url = state?.link?.url ?? "";
      expect(idAus(url)).toBe(id);
      const row = await prisma.spaceInvitation.findUniqueOrThrow({
        where: { id },
        select: { tokenHash: true, acceptedAt: true, expiresAt: true },
      });
      expect(verifyToken(tokenAus(url), row.tokenHash)).toBe(true);
      expect(row.acceptedAt).toBeNull();
      expect(row.expiresAt.getTime()).toBeGreaterThan(vorher);
    },
  );

  it("ersetzt beim erneuten Einladen den Link", async () => {
    const space = await spaceMit("OWNER", { isAdmin: true });
    const email = adresse();
    const a = await inviteMemberAction(undefined, formular(space.slug, email));
    const b = await inviteMemberAction(undefined, formular(space.slug, email));
    const link1 = a?.link?.url ?? "";
    const link2 = b?.link?.url ?? "";

    expect(idAus(link1)).toBe(idAus(link2));
    expect(tokenAus(link1)).not.toBe(tokenAus(link2));
    const hash = await tokenHash(idAus(link2));
    expect(verifyToken(tokenAus(link1), hash)).toBe(false);
    expect(verifyToken(tokenAus(link2), hash)).toBe(true);
  });

  it("gibt ohne Verwaltungsrecht keinen Link", async () => {
    const mitglied = await spaceMit("MEMBER", { isAdmin: true });
    const email = adresse();
    await expect(
      inviteMemberAction(undefined, formular(mitglied.slug, email)),
    ).rejects.toThrow("Kein Zugriff auf diese Aktion");
    expect(
      await prisma.spaceInvitation.count({
        where: { spaceId: mitglied.id, email },
      }),
    ).toBe(0);

    // Positivkontrolle: dieselbe Einladung als Owner liefert den Link.
    const owner = await spaceMit("OWNER", { isAdmin: true });
    const state = await inviteMemberAction(undefined, formular(owner.slug, email));
    expect(state?.link?.url).toContain("/invite/");
  });

  it("gibt nach Vorgabe einem Owner ohne Admin-Recht keinen Link", async () => {
    const space = await spaceMit("OWNER", { isAdmin: false });
    const email = adresse();
    const state = await inviteMemberAction(undefined, formular(space.slug, email));

    expect(state?.link).toBeUndefined();
    expect(state?.success).toBeUndefined();
    expect(state?.error).toContain("nicht zugestellt");
    const row = await prisma.spaceInvitation.findUniqueOrThrow({
      where: { spaceId_email: { spaceId: space.id, email } },
      select: { id: true },
    });
    expect((await einladungsAudit(row.id)).map((e) => e.metadata)).toEqual([
      { email, role: "MEMBER", delivery: "none" },
    ]);

    // Transportfehler ohne fruehere Einladung: Bestandsmeldung, kein Link,
    // kein Audit.
    const andere = adresse();
    mocks.smtp = "wirft";
    const fehler = await inviteMemberAction(
      undefined,
      formular(space.slug, andere),
    );
    expect(fehler).toEqual({ error: TRANSPORT_FEHLER });
    const zweite = await prisma.spaceInvitation.findUniqueOrThrow({
      where: { spaceId_email: { spaceId: space.id, email: andere } },
      select: { id: true },
    });
    expect(await einladungsAudit(zweite.id)).toHaveLength(0);
  });

  it("gibt mit INVITE_LINK_WITHOUT_MAIL=managers auch Owner ohne Admin-Recht den Link", async () => {
    vi.stubEnv("INVITE_LINK_WITHOUT_MAIL", "managers");
    const space = await spaceMit("OWNER", { isAdmin: false });
    const email = adresse();
    const state = await inviteMemberAction(undefined, formular(space.slug, email));

    const url = state?.link?.url ?? "";
    expect(verifyToken(tokenAus(url), await tokenHash(idAus(url)))).toBe(true);
  });

  it("zeigt den Link auch in der Entwicklung, wo er zusaetzlich im Log steht", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const space = await spaceMit("OWNER", { isAdmin: true });
    const email = adresse();
    const state = await inviteMemberAction(undefined, formular(space.slug, email));

    const url = state?.link?.url ?? "";
    expect(url).toContain("/invite/");
    expect(state?.success).not.toContain("gesendet");
    // Dev-Fallback (Bestand): der Link steht im Log.
    expect(spione.warn).toHaveBeenCalledWith({ url }, expect.any(String));
    expect((await einladungsAudit(idAus(url))).map((e) => e.metadata)).toEqual(
      [{ email, role: "MEMBER", delivery: "link" }],
    );
  });
});
