import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";
import { resolveOidcUser, type OidcOptions } from "@/lib/oidc-account";
import { USER_NAME_MAX, userNameSchema } from "@/lib/user-name";

/**
 * Wer darf sich über SSO als wer anmelden?
 *
 * Die Frage entscheidet über Kontoübernahme, also gehört sie gegen eine
 * echte Datenbank geprüft: an Eindeutigkeit von Aussteller und Subject,
 * an bestehenden Adressen und an der Reihenfolge der Bedingungen.
 */
const TAG = `oidc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ISSUER = "https://idp.example";

const base: OidcOptions = {
  issuer: ISSUER,
  allowSignup: false,
  autoLinkByEmail: true,
};

const claims = (over: Partial<Parameters<typeof resolveOidcUser>[0]> = {}) => ({
  subject: `${TAG}-sub`,
  email: `${TAG}@example.test`,
  emailVerified: true,
  name: "SSO Person",
  ...over,
});

/** Konten dieses Laufs, damit `isFirstUser` nie zufaellig greift. */
let ballast: string;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-ballast@example.test`,
      name: "Ballast",
      passwordHash: "x",
    },
    select: { id: true },
  });
  ballast = user.id;
});

afterEach(async () => {
  await prisma.user.deleteMany({
    where: { OR: [{ id: ballast }, { email: { startsWith: TAG } }] },
  });
});

async function makeUser(over: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: {
      email: `${TAG}@example.test`,
      name: "Bestehend",
      passwordHash: "x",
      ...over,
    },
    select: { id: true },
  });
}

describe("Bindung an Aussteller und Subject", () => {
  it("findet das verknüpfte Konto wieder", async () => {
    const user = await makeUser({
      oidcIssuer: ISSUER,
      oidcSubject: `${TAG}-sub`,
    });
    const out = await resolveOidcUser(claims(), base);
    expect(out).toMatchObject({ user: { id: user.id } });
  });

  it("nimmt dasselbe Subject bei einem anderen Aussteller nicht", async () => {
    await makeUser({
      email: `${TAG}-alt@example.test`,
      oidcIssuer: "https://alter-anbieter.example",
      oidcSubject: `${TAG}-sub`,
    });
    // Kein Treffer über das Subject, und die Adresse aus den Claims
    // gehört zu niemandem: also kein Konto.
    const out = await resolveOidcUser(claims(), base);
    expect(out).toEqual({ reason: "no_account" });
  });

  it("lässt ein deaktiviertes Konto nicht herein", async () => {
    await makeUser({
      oidcIssuer: ISSUER,
      oidcSubject: `${TAG}-sub`,
      isActive: false,
    });
    expect(await resolveOidcUser(claims(), base)).toEqual({
      reason: "inactive",
    });
  });
});

describe("Verknüpfung über die E-Mail-Adresse", () => {
  it("verknüpft eine bestätigte Adresse mit dem bestehenden Konto", async () => {
    const user = await makeUser();
    const out = await resolveOidcUser(claims(), base);
    expect(out).toMatchObject({ user: { id: user.id } });

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { oidcSubject: true, oidcIssuer: true },
    });
    expect(row).toEqual({ oidcSubject: `${TAG}-sub`, oidcIssuer: ISSUER });
  });

  it("verweigert eine unbestätigte Adresse", async () => {
    const user = await makeUser();
    expect(
      await resolveOidcUser(claims({ emailVerified: false }), base),
    ).toEqual({ reason: "unverified" });

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { oidcSubject: true },
    });
    expect(row?.oidcSubject).toBeNull();
  });

  it("fasst ein Konto mit Verwaltungsrechten nicht an", async () => {
    // Wird eine Adresse im Verzeichnis neu vergeben, wäre das sonst die
    // Übernahme der ganzen Instanz.
    await makeUser({ isAdmin: true });
    expect(await resolveOidcUser(claims(), base)).toEqual({
      reason: "admin_link",
    });
  });

  it("verweigert die Verknüpfung, wenn die Instanz sie abschaltet", async () => {
    await makeUser();
    expect(
      await resolveOidcUser(claims(), { ...base, autoLinkByEmail: false }),
    ).toEqual({ reason: "no_link" });
  });

  it("nimmt kein Konto, das schon anderswo verknüpft ist", async () => {
    await makeUser({
      oidcIssuer: "https://alter-anbieter.example",
      oidcSubject: `${TAG}-fremd`,
    });
    expect(await resolveOidcUser(claims(), base)).toEqual({
      reason: "linked_elsewhere",
    });
  });
});

describe("Kontoanlage", () => {
  it("legt ohne ausdrückliche Erlaubnis nichts an", async () => {
    expect(await resolveOidcUser(claims(), base)).toEqual({
      reason: "no_account",
    });
    expect(
      await prisma.user.count({ where: { email: `${TAG}@example.test` } }),
    ).toBe(0);
  });

  it("legt mit Erlaubnis ein Konto ohne Verwaltungsrechte an", async () => {
    const out = await resolveOidcUser(claims(), { ...base, allowSignup: true });
    expect("user" in out).toBe(true);

    const row = await prisma.user.findUnique({
      where: { email: `${TAG}@example.test` },
      select: { isAdmin: true, oidcIssuer: true, name: true },
    });
    expect(row).toEqual({
      isAdmin: false,
      oidcIssuer: ISSUER,
      name: "SSO Person",
    });
  });

  describe("Name des Anbieters nach der Regel von Registrierung und Profil", () => {
    // Der Claim kommt ohne Grenze und wanderte bisher unverändert ins
    // Konto. Mit 81 Zeichen oder mit einem einzigen liess sich das Profil
    // danach nicht speichern, ohne den Namen zu ändern (lib/user-name).
    const R = "\u{1F680}";
    const signup = { ...base, allowSignup: true };
    const nameOf = async () =>
      (
        await prisma.user.findUniqueOrThrow({
          where: { email: `${TAG}@example.test` },
          select: { name: true },
        })
      ).name;

    it("kappt einen zu langen Namen in Codepoints", async () => {
      // Die Rakete an Stelle 80 bleibt ganz, in der Datenbank steht kein
      // Ersatzzeichen.
      const x = "x".repeat(USER_NAME_MAX - 1);
      const out = await resolveOidcUser(claims({ name: `${x}${R}${R}` }), signup);
      expect("user" in out).toBe(true);
      expect(await nameOf()).toBe(`${x}${R}`);
      expect(userNameSchema.safeParse(await nameOf()).success).toBe(true);
    });

    it("nimmt für einen zu kurzen Namen den Lokalteil der Adresse", async () => {
      const out = await resolveOidcUser(claims({ name: R }), signup);
      expect("user" in out).toBe(true);
      expect(await nameOf()).toBe(TAG);
    });
  });

  it("braucht eine bestätigte Adresse auch für ein neues Konto", async () => {
    expect(
      await resolveOidcUser(claims({ emailVerified: false }), {
        ...base,
        allowSignup: true,
      }),
    ).toEqual({ reason: "unverified" });
  });

  it("kommt ohne Adresse nicht weiter", async () => {
    expect(
      await resolveOidcUser(claims({ email: null }), {
        ...base,
        allowSignup: true,
      }),
    ).toEqual({ reason: "no_email" });
  });
});
