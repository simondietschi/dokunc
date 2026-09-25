import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Geschützte Seiten, geprüft an den Actions selbst.
 *
 * access.test.ts und authorization.test.ts prüfen die Helfer in
 * lib/page-guards. Ein Fehler in der Verdrahtung bliebe dort grün: eine
 * Action, die wieder ein eigenes findFirst schreibt, den Scope falsch
 * zusammensetzt oder den Filter für Vorlagen vergisst. Deshalb hier der
 * Auslöser selbst: ein MEMBER ohne Freigabe schickt ein Formular mit der
 * ID einer geschützten Seite.
 *
 * Wie in refusals.test.ts läuft die echte Action gegen die echte
 * Datenbank; ersetzt sind nur Anmeldung, Anfrage-Header, Cache und die
 * Umleitung.
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
  requireUser: vi.fn(async () => mocks.actor),
  requireAdmin: vi.fn(async () => mocks.actor),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));

const { duplicatePageAction } = await import("@/app/s/[slug]/template-actions");
const { createPageAction, setPageIconAction } = await import(
  "@/app/s/[slug]/actions"
);
const { createThreadAction } = await import(
  "@/app/s/[slug]/p/[pageId]/comments/actions"
);
const { setPageRestricted } = await import("@/lib/page-access");

const TAG = `pact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let member: Actor;
let owner: { id: string };
let spaceId: string;
let offen: string;
let geschuetzt: string;
let vorlage: string;

/** Adresse, auf die die Action umleitet — oder null, wenn sie normal endet. */
async function umleitung(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (e) {
    if (e instanceof mocks.Umleitung) return e.url;
    throw e;
  }
}

function formular(felder: Record<string, string>): FormData {
  const f = new FormData();
  f.set("slug", TAG);
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  const m = await prisma.user.create({
    data: { email: `${TAG}-member@example.test`, name: "Member", passwordHash: "x" },
    select: { id: true, email: true, name: true },
  });
  member = { ...m, isAdmin: false };
  owner = await prisma.user.create({
    data: { email: `${TAG}-owner@example.test`, name: "Owner", passwordHash: "x" },
    select: { id: true },
  });
  const space = await prisma.space.create({
    data: {
      name: TAG,
      slug: TAG,
      members: {
        create: [
          { userId: member.id, role: "MEMBER" },
          { userId: owner.id, role: "OWNER" },
        ],
      },
    },
    select: { id: true },
  });
  spaceId = space.id;

  offen = (
    await prisma.page.create({
      data: { spaceId, title: `${TAG}-offen`, position: 0 },
      select: { id: true },
    })
  ).id;
  geschuetzt = (
    await prisma.page.create({
      data: {
        spaceId,
        parentId: offen,
        title: `${TAG}-geschuetzt`,
        position: 0,
      },
      select: { id: true },
    })
  ).id;
  // Geschützt von der Eigentümerin; der MEMBER steht nicht auf der Liste.
  await setPageRestricted(geschuetzt, true, owner.id);
  vorlage = (
    await prisma.page.create({
      data: { spaceId, title: `${TAG}-vorlage`, isTemplate: true },
      select: { id: true },
    })
  ).id;

  mocks.actor = member;
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("duplicatePageAction", () => {
  it("kopiert eine geschützte Seite nicht für einen MEMBER ohne Freigabe", async () => {
    await expect(
      duplicatePageAction(formular({ pageId: geschuetzt })),
    ).rejects.toThrow("Seite nicht gefunden");
    expect(
      await prisma.page.count({ where: { spaceId, title: `${TAG}-geschuetzt` } }),
    ).toBe(1);
  });

  it("lässt beim Kopieren mit Unterseiten die geschützte weg", async () => {
    const ziel = await umleitung(
      duplicatePageAction(formular({ pageId: offen, withChildren: "1" })),
    );
    const kopie = ziel?.split("/p/")[1];
    expect(kopie).toBeTruthy();
    expect(kopie).not.toBe(offen);
    // Die Kopie selbst ist da, ihre geschützte Unterseite nicht: deren
    // Inhalt wanderte sonst über die offene Kopie an den ganzen Space.
    expect(await prisma.page.count({ where: { parentId: kopie } })).toBe(0);
    expect(
      await prisma.page.count({ where: { spaceId, title: `${TAG}-geschuetzt` } }),
    ).toBe(1);
  });
});

describe("setPageIconAction", () => {
  it("setzt kein Symbol auf eine geschützte Seite ohne Freigabe", async () => {
    await expect(
      setPageIconAction(formular({ pageId: geschuetzt, icon: "📌" })),
    ).rejects.toThrow();
    const danach = await prisma.page.findUnique({ where: { id: geschuetzt } });
    expect(danach?.icon).toBeNull();
  });

  it("setzt es auf einer offenen Seite weiterhin", async () => {
    await setPageIconAction(formular({ pageId: offen, icon: "📌" }));
    const danach = await prisma.page.findUnique({ where: { id: offen } });
    expect(danach?.icon).toBe("📌");
  });
});

describe("createThreadAction", () => {
  it("legt keinen Kommentar auf einer geschützten Seite ohne Freigabe an", async () => {
    const threadId = randomUUID();
    await createThreadAction(
      formular({ pageId: geschuetzt, threadId, body: "Hallo" }),
    );
    expect(await prisma.comment.count({ where: { id: threadId } })).toBe(0);
  });

  it("legt ihn auf einer offenen Seite weiterhin an", async () => {
    const threadId = randomUUID();
    await createThreadAction(formular({ pageId: offen, threadId, body: "Hallo" }));
    expect(await prisma.comment.count({ where: { id: threadId } })).toBe(1);
  });
});

describe("createPageAction", () => {
  it("hängt keine neue Seite unter eine Vorlage", async () => {
    await expect(
      createPageAction(formular({ parentId: vorlage })),
    ).rejects.toThrow();
    expect(await prisma.page.count({ where: { parentId: vorlage } })).toBe(0);
  });

  it("hängt keine neue Seite unter eine geschützte Seite ohne Freigabe", async () => {
    await expect(
      createPageAction(formular({ parentId: geschuetzt })),
    ).rejects.toThrow();
    expect(await prisma.page.count({ where: { parentId: geschuetzt } })).toBe(0);
  });
});
