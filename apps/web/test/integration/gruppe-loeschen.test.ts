import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { ACCESS_REVOKED_CHANNEL } from "@dokunc/editor";
import { prisma } from "@dokunc/db";
import { redisUrlMitDb } from "./collab-pruefserver";

/**
 * Gruppe löschen und Mitglied entfernen trennen offene Editoren sofort.
 *
 * Der Collab-Server prüft Rolle und Freigaben nur beim Verbinden und in
 * einer Runde je Minute. Ohne Nachricht auf ACCESS_REVOKED_CHANNEL
 * schreibt eine Person, die ihren Zugang mit der Gruppe verloren hat,
 * bis zu einer Minute weiter. Betroffen sind die Spaces, in denen die
 * Gruppe eine Rolle hat, und die, in denen sie nur eine Freigabe auf
 * eine geschützte Seite hat: die Kaskade nimmt beide mit.
 *
 * Der Abonnent liest auf Redis-DB 6 (Belegung in collab-pruefserver.ts).
 * Pub/Sub gilt über alle Datenbanken: gezählt wird nur, was eine Person
 * dieses Laufs nennt.
 */

type Nutzer = { id: string; email: string; name: string; isAdmin: boolean };
const admin: { nutzer: Nutzer | null } = { nutzer: null };

class Umleitung extends Error {}
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: async () => admin.nutzer,
  requireUser: async () => admin.nutzer,
  requireAdmin: async () => admin.nutzer,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    throw new Umleitung(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { deleteGroupAction, removeGroupMemberAction } = await import(
  "@/app/admin/groups/actions"
);

const TAG = `grplos-${Date.now()}-${randomBytes(3).toString("hex")}`;
const u = {} as Record<"u1" | "u2" | "u3" | "admin", string>;
const s = {} as Record<"s1" | "s2" | "s3", string>;

let abo: Redis;
const nachrichten: string[] = [];
const eigene = new Set<string>();

async function nutzer(name: string, isAdmin = false) {
  const email = `${TAG}-${name}@example.test`;
  const x = await prisma.user.create({
    data: { email, name, passwordHash: "x", isAdmin },
    select: { id: true },
  });
  eigene.add(x.id);
  return x.id;
}

async function space(name: string, direkt: { userId: string; role: "VIEWER" | "MEMBER" }[]) {
  return (
    await prisma.space.create({
      data: { name: `${TAG}-${name}`, slug: `${TAG}-${name}`, members: { create: direkt } },
      select: { id: true },
    })
  ).id;
}

/** Geschützte Seite in einem Space, freigegeben für die Gruppe. */
async function freigabeFuer(groupId: string, spaceId: string) {
  const p = await prisma.page.create({
    data: { spaceId, title: "Personal", isRestricted: true },
    select: { id: true },
  });
  await prisma.page.update({ where: { id: p.id }, data: { accessRootId: p.id } });
  await prisma.pageGrant.create({ data: { pageId: p.id, groupId } });
}

async function gruppe(
  name: string,
  o: { mitglieder: string[]; rolleIn?: string[]; freigabeIn?: string[] },
) {
  const g = await prisma.group.create({
    data: {
      name: `${TAG}-${name}`,
      members: { create: o.mitglieder.map((userId) => ({ userId })) },
      spaces: { create: (o.rolleIn ?? []).map((spaceId) => ({ spaceId, role: "MEMBER" as const })) },
    },
    select: { id: true },
  });
  for (const spaceId of o.freigabeIn ?? []) await freigabeFuer(g.id, spaceId);
  return g.id;
}

function formular(felder: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

/** Ruft die Action auf; sie endet regulär mit der Umleitung zur Liste. */
async function rufe(lauf: () => Promise<unknown>) {
  await expect(lauf()).rejects.toBeInstanceOf(Umleitung);
}

const paar = (userId: string, spaceId: string) => `${userId}:${spaceId}`;

/**
 * Wartet, bis alle erwarteten Nachrichten da sind, und danach noch
 * 300 ms, damit eine überzählige auffällt (alle gehen in einem Zug raus).
 */
async function empfangen(erwartet: string[]): Promise<string[]> {
  for (let i = 0; i < 100 && !erwartet.every((e) => nachrichten.includes(e)); i++) {
    await new Promise((r) => setTimeout(r, 30));
  }
  await new Promise((r) => setTimeout(r, 300));
  return [...nachrichten].sort();
}

beforeAll(async () => {
  u.u1 = await nutzer("u1");
  u.u2 = await nutzer("u2");
  u.u3 = await nutzer("u3");
  u.admin = await nutzer("admin", true);
  admin.nutzer = {
    id: u.admin,
    email: `${TAG}-admin@example.test`,
    name: "admin",
    isAdmin: true,
  };
  s.s1 = await space("s1", []);
  // U1 und U2 sind hier direkt VIEWER; die Gruppe hat nur eine Freigabe.
  s.s2 = await space("s2", [
    { userId: u.u1, role: "VIEWER" },
    { userId: u.u2, role: "VIEWER" },
  ]);
  // U1 ist hier Mitglied, die Gruppe hat hier nichts.
  s.s3 = await space("s3", [{ userId: u.u1, role: "MEMBER" }]);

  abo = new Redis(redisUrlMitDb(6), { maxRetriesPerRequest: 1 });
  await abo.subscribe(ACCESS_REVOKED_CHANNEL);
  abo.on("message", (_kanal, text: string) => {
    const m = JSON.parse(text) as { userId: string; spaceId: string };
    if (eigene.has(m.userId)) nachrichten.push(paar(m.userId, m.spaceId));
  });
});

beforeEach(() => {
  nachrichten.length = 0;
});

afterAll(async () => {
  await abo.quit();
  await prisma.group.deleteMany({ where: { name: { startsWith: `${TAG}-` } } });
  await prisma.space.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}-` } } });
});

describe("deleteGroupAction", () => {
  it("trennt jedes Mitglied in jedem Space mit Rolle oder Freigabe der Gruppe", async () => {
    const g = await gruppe("rolle-und-freigabe", {
      mitglieder: [u.u1, u.u2],
      rolleIn: [s.s1],
      freigabeIn: [s.s2],
    });
    await rufe(() => deleteGroupAction(formular({ groupId: g })));

    const erwartet = [
      paar(u.u1, s.s1),
      paar(u.u2, s.s1),
      paar(u.u1, s.s2),
      paar(u.u2, s.s2),
    ].sort();
    expect(await empfangen(erwartet)).toEqual(erwartet);
    expect(await prisma.group.count({ where: { id: g } })).toBe(0);
  });

  it("wer während des Löschens dazukommt, wird mit getrennt", async () => {
    const g = await gruppe("waehrenddessen", { mitglieder: [u.u1], rolleIn: [s.s1] });

    // Eine zweite Transaktion trägt U3 ein und hält ihre Sperre auf der
    // Gruppenzeile, während das Löschen beginnt.
    let eingetragen!: () => void;
    const istEingetragen = new Promise<void>((r) => (eingetragen = r));
    const hinzufuegen = prisma.$transaction(async (tx) => {
      await tx.groupMember.create({ data: { groupId: g, userId: u.u3 } });
      eingetragen();
      await new Promise((r) => setTimeout(r, 500));
    });
    await istEingetragen;
    await rufe(() => deleteGroupAction(formular({ groupId: g })));
    await hinzufuegen;

    const erwartet = [paar(u.u1, s.s1), paar(u.u3, s.s1)].sort();
    expect(await empfangen(erwartet)).toEqual(erwartet);
  });

  it("eine unbekannte Gruppe: nichts gesendet", async () => {
    await deleteGroupAction(formular({ groupId: "gibt-es-nicht" }));
    expect(await empfangen([])).toEqual([]);
  });
});

describe("removeGroupMemberAction", () => {
  it("trennt das Mitglied auch in Spaces, in denen die Gruppe nur eine Freigabe hat", async () => {
    const g = await gruppe("mitglied", {
      mitglieder: [u.u1, u.u2],
      rolleIn: [s.s1],
      freigabeIn: [s.s2],
    });
    await rufe(() => removeGroupMemberAction(formular({ groupId: g, userId: u.u1 })));

    const erwartet = [paar(u.u1, s.s1), paar(u.u1, s.s2)].sort();
    expect(await empfangen(erwartet)).toEqual(erwartet);
  });
});
