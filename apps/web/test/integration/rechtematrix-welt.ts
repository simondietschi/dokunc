import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@dokunc/db";
import { setPageRestricted } from "@/lib/page-access";
import { seal } from "@/lib/secret-box";
import { generateTotpSecret } from "@/lib/totp";
import type { Akteur } from "../rechtematrix/erwartung";

/**
 * Die Welt der Rechtematrix: ein Space, je Akteur eine Person mit echter
 * Sitzungszeile, und der Zustand, aus dem die Attrappen im Matrix-Lauf
 * (rechtematrix.test.ts) Anmeldung und Anfrage-Header beziehen.
 *
 * Für Ergänzungen anderer Prüfungen offen: `neuePerson` legt weitere
 * Personen mit echtem Passworthash an, `alsPerson` führt beliebigen Code
 * als diese Person aus, und die Attrappe von `@/lib/current-user`
 * beachtet einen Widerruf der Sitzungszeile.
 */

/** Passwort aller Personen der Welt (bcrypt mit Kosten 4, schnell genug für Tests). */
export const MATRIX_PASSWORT = "Matrix-Test-1!";

export type Person = {
  id: string;
  email: string;
  /** Echte Session-Zeile; ihr Widerruf meldet die Person ab. */
  sessionId: string;
  /** Nur mit `neuePerson({ totp: true })`: das TOTP-Geheimnis im Klartext. */
  totpGeheimnis?: string;
};

export type Welt = {
  space: { id: string; slug: string };
  personen: Record<Exclude<Akteur, "abgemeldet">, Person>;
  /** Schützt die Seite (als OWNER) und gibt sie VIEWER und MEMBER_FREIGABE frei. */
  schuetze(pageId: string): Promise<void>;
  neuePerson(o?: { totp?: boolean }): Promise<Person>;
  /** Führt `fn` als diese Person aus; null = abgemeldet. */
  alsPerson<T>(p: Person | null, fn: () => Promise<T>): Promise<T>;
  /** Merkt eine Aufräumarbeit für das Ende des laufenden Falls vor. */
  spaeter(fn: () => Promise<unknown>): void;
  /** Leert den Space und führt die vorgemerkten Aufräumarbeiten aus. */
  aufraeumen(): Promise<void>;
};

/** Ergebnis von `redirect()` im Matrix-Lauf: kommt als Fehler mit Ziel an. */
export class Umleitung extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`Umleitung nach ${url}`);
    this.url = url;
  }
}

/**
 * Wer gerade handelt und von welcher Adresse. Die Attrappen lesen das;
 * geschrieben wird es nur über `alsPerson`.
 */
export const zustand: { person: Person | null; ip: string } = {
  person: null,
  ip: "198.51.100.1",
};

let adressZaehler = 0;
/** Je Aufruf eine neue Adresse aus den Dokumentationsnetzen, damit keine Bremse greift. */
function naechsteAdresse(): string {
  adressZaehler += 1;
  const netz = adressZaehler % 2 === 0 ? "198.51.100" : "203.0.113";
  return `${netz}.${(adressZaehler % 250) + 1}`;
}

export type SitzungsNutzer = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  tokenVersion: number;
  sessionId: string;
};

/**
 * Die angemeldete Person wie `getCurrentUser`: null ohne Person, bei
 * widerrufener oder abgelaufener Sitzung und bei deaktiviertem Konto.
 */
export async function sitzungsNutzer(): Promise<SitzungsNutzer | null> {
  const p = zustand.person;
  if (!p) return null;
  const s = await prisma.session.findUnique({
    where: { id: p.sessionId },
    select: {
      id: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          isAdmin: true,
          isActive: true,
          tokenVersion: true,
        },
      },
    },
  });
  if (!s || s.revokedAt || s.expiresAt.getTime() < Date.now()) return null;
  if (!s.user.isActive) return null;
  const { isActive: _aktiv, ...user } = s.user;
  return { ...user, sessionId: s.id };
}

/** Ersatz für `@/lib/current-user` im Matrix-Lauf. */
export function currentUserAttrappe(wirfUmleitung: (url: string) => never) {
  async function requireUser() {
    const user = await sitzungsNutzer();
    if (!user) wirfUmleitung("/login");
    return user;
  }
  return {
    getCurrentUser: sitzungsNutzer,
    requireUser,
    async requireAdmin() {
      const user = await requireUser();
      if (!user.isAdmin) wirfUmleitung("/spaces");
      return user;
    },
  };
}

/** Ersatz für `next/headers`: Adresse je Fall, Cookies als leerer Speicher. */
export function headersAttrappe() {
  const cookies = new Map<string, string>();
  return {
    headers: async () => new Headers({ "x-forwarded-for": zustand.ip }),
    cookies: async () => ({
      get: (name: string) =>
        cookies.has(name) ? { name, value: cookies.get(name)! } : undefined,
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      has: (name: string) => cookies.has(name),
      set: (name: string, value: string) => void cookies.set(name, value),
      delete: (name: string) => void cookies.delete(name),
    }),
  };
}

let hashCache: string | null = null;
async function passwortHash(): Promise<string> {
  hashCache ??= await bcrypt.hash(MATRIX_PASSWORT, 4);
  return hashCache;
}

/** Baut die Welt: Space, Personen, Mitgliedschaften, Sitzungen. */
export async function baueWelt(): Promise<Welt> {
  const tag = `matrix-${Date.now()}-${randomBytes(3).toString("hex")}`;
  let nr = 0;
  const aufraeumen: (() => Promise<unknown>)[] = [];

  async function neuePerson(
    o: { totp?: boolean; isAdmin?: boolean; name?: string } = {},
  ): Promise<Person> {
    nr += 1;
    const email = `${tag}-${nr}@example.test`;
    const totpGeheimnis = o.totp ? generateTotpSecret() : undefined;
    const user = await prisma.user.create({
      data: {
        email,
        name: o.name ?? `Matrix ${nr}`,
        passwordHash: await passwortHash(),
        isAdmin: o.isAdmin ?? false,
        ...(totpGeheimnis
          ? { totpSecret: seal(totpGeheimnis), totpEnabledAt: new Date() }
          : {}),
      },
      select: { id: true, email: true },
    });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
      select: { id: true },
    });
    return {
      id: user.id,
      email: user.email,
      sessionId: session.id,
      ...(totpGeheimnis ? { totpGeheimnis } : {}),
    };
  }

  const personen = {
    fremd: await neuePerson({ name: "Fremd" }),
    instanzAdmin: await neuePerson({ name: "Instanz-Admin", isAdmin: true }),
    VIEWER: await neuePerson({ name: "Viewer" }),
    MEMBER: await neuePerson({ name: "Member" }),
    MEMBER_FREIGABE: await neuePerson({ name: "Member mit Freigabe" }),
    ADMIN: await neuePerson({ name: "Admin" }),
    OWNER: await neuePerson({ name: "Owner" }),
  } satisfies Welt["personen"];

  const space = await prisma.space.create({
    data: {
      name: tag,
      slug: tag,
      members: {
        create: [
          { userId: personen.VIEWER.id, role: "VIEWER" },
          { userId: personen.MEMBER.id, role: "MEMBER" },
          { userId: personen.MEMBER_FREIGABE.id, role: "MEMBER" },
          { userId: personen.ADMIN.id, role: "ADMIN" },
          { userId: personen.OWNER.id, role: "OWNER" },
        ],
      },
    },
    select: { id: true, slug: true },
  });

  return {
    space,
    personen,
    async schuetze(pageId) {
      await setPageRestricted(pageId, true, personen.OWNER.id);
      await prisma.pageGrant.createMany({
        data: [
          { pageId, userId: personen.VIEWER.id },
          { pageId, userId: personen.MEMBER_FREIGABE.id },
        ],
        skipDuplicates: true,
      });
    },
    neuePerson,
    async alsPerson(p, fn) {
      zustand.person = p;
      zustand.ip = naechsteAdresse();
      try {
        return await fn();
      } finally {
        zustand.person = null;
      }
    },
    spaeter(fn) {
      aufraeumen.push(fn);
    },
    async aufraeumen() {
      for (const fn of aufraeumen.splice(0)) await fn();
      await prisma.page.deleteMany({ where: { spaceId: space.id } });
    },
  };
}

/** Räumt die Welt ab: Space samt Seiten, dann alle Personen dieses Laufs. */
export async function raeumeWelt(w: Welt): Promise<void> {
  await w.aufraeumen();
  await prisma.space.deleteMany({ where: { id: w.space.id } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: `${w.space.slug}-` } },
  });
}
