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
import pino from "pino";
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
  smtp: "fehlt" as "fehlt" | "ok" | "wirft" | "abgelehnt",
}));

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => mocks.actor),
  getCurrentUser: vi.fn(async () => mocks.actor),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@dokunc/mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dokunc/mail")>()),
  sendMail: vi.fn(async (msg: { to: string }) => {
    if (mocks.smtp === "abgelehnt") {
      // Wie nodemailer einen abgewiesenen Empfaenger meldet (Form aus
      // einem Gespraech mit einem SMTP-Server, mail-smtp.test.ts): die
      // Adresse steht in message, response, rejected und rejectedErrors,
      // vom Server gern gross geschrieben.
      const response = `550 5.1.1 <${msg.to.toUpperCase()}>: Recipient address rejected`;
      throw Object.assign(new Error(`Can't send mail - all recipients were rejected: ${response}`), {
        code: "EENVELOPE",
        response,
        responseCode: 550,
        command: "RCPT TO",
        rejected: [msg.to],
        rejectedErrors: [{ code: "EENVELOPE", response, responseCode: 550, recipient: msg.to }],
      });
    }
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
const bleibtUnveraendert = (email: string) =>
  `Es ist kein Mailserver eingerichtet, und für ${email} gibt es schon eine gültige Einladung. Sie bleibt unverändert; ändern oder neu aussprechen kann sie eine Admin-Person der Instanz, die diesen Space verwaltet.`;

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

/** Weitere Person mit dieser Rolle im selben Space; sie handelt ab jetzt. */
async function zweitePerson(
  spaceId: string,
  rolle: SpaceRole,
  { isAdmin }: { isAdmin: boolean },
): Promise<Actor> {
  const person = await prisma.user.create({
    data: {
      email: `${TAG}-zweite-${userIds.length}@example.test`,
      name: `Zweite ${userIds.length}`,
      passwordHash: "x",
      isAdmin,
      memberships: { create: { spaceId, role: rolle } },
    },
    select: { id: true, email: true, name: true, isAdmin: true },
  });
  userIds.push(person.id);
  mocks.actor = person;
  return person;
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

  it("loggt einen abgewiesenen Empfaenger mit Code und Stack, aber ohne seine Adresse", async () => {
    const space = await spaceMit("OWNER", { isAdmin: true });
    const email = adresse();
    mocks.smtp = "abgelehnt";
    const state = await inviteMemberAction(undefined, formular(space.slug, email));
    expect(state?.error).toBe(TRANSPORT_FEHLER);

    const aufruf = spione.error.mock.calls.find(
      (c) => c[1] === "Einladungsmail konnte nicht gesendet werden",
    );
    expect(aufruf).toBeDefined();
    const felder = aufruf?.[0] as unknown as { err: unknown; invitationId: string };
    // So, wie pino das Feld schreibt: Typ, Stack und SMTP-Code bleiben.
    expect(felder.err).toBeInstanceOf(Error);
    const err = pino.stdSerializers.err(felder.err as Error);
    expect(err).toMatchObject({ type: "Error", code: "EENVELOPE", responseCode: 550 });
    expect(err.message).toContain("Recipient address rejected");
    expect(err.stack).toContain("[adresse]");
    expect(JSON.stringify(err).toLowerCase()).not.toContain(email.toLowerCase());
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

  it("laesst einen weitergegebenen Link stehen, wenn eine Verwaltung ohne Link-Recht erneut einlaedt", async () => {
    const space = await spaceMit("OWNER", { isAdmin: true });
    const admin = mocks.actor!;
    const email = adresse();
    const erste = await inviteMemberAction(undefined, formular(space.slug, email));
    const link1 = erste?.link?.url ?? "";
    const id = idAus(link1);
    expect(verifyToken(tokenAus(link1), await tokenHash(id))).toBe(true);

    // Eine zweite Owner-Person ohne Admin-Recht laedt dieselbe Adresse mit
    // anderer Rolle ein. Ihren Link saehe niemand.
    await zweitePerson(space.id, "OWNER", { isAdmin: false });
    const state = await inviteMemberAction(
      undefined,
      formular(space.slug, email, "ADMIN"),
    );

    expect(state).toEqual({ error: bleibtUnveraendert(email) });
    const row = await prisma.spaceInvitation.findUniqueOrThrow({
      where: { id },
      select: { tokenHash: true, role: true, invitedById: true },
    });
    expect(verifyToken(tokenAus(link1), row.tokenHash)).toBe(true);
    expect(row.role).toBe("MEMBER");
    expect(row.invitedById).toBe(admin.id);
    // Nur der Eintrag der ersten Einladung.
    expect(await einladungsAudit(id)).toHaveLength(1);

    // Ist die fruehere Einladung abgelaufen, gibt es nichts zu schuetzen:
    // die neue Zeile gilt, gemeldet wird "nicht zugestellt".
    await prisma.spaceInvitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const danach = await inviteMemberAction(
      undefined,
      formular(space.slug, email, "ADMIN"),
    );
    expect(danach?.link).toBeUndefined();
    expect(danach?.error).toContain("nicht zugestellt");
    const neu = await prisma.spaceInvitation.findUniqueOrThrow({
      where: { id },
      select: { tokenHash: true, role: true, expiresAt: true },
    });
    expect(neu.role).toBe("ADMIN");
    expect(neu.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(verifyToken(tokenAus(link1), neu.tokenHash)).toBe(false);
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
