import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Audit-Spur beim Loeschen eines Space, geprueft an der Action der Owner
 * selbst: die Eintraege des Space bleiben (AuditLog.spaceId wird NULL),
 * und "space.deleted" entsteht erst nach der erfolgreichen Loeschung.
 *
 * Wie in page-actions.test.ts laeuft die echte Action gegen die echte
 * Datenbank; ersetzt sind Anmeldung, Anfrage-Header, Cache und Umleitung,
 * dazu deleteSpaceWithUploads mit einem Schalter, der sie scheitern
 * laesst (wie eine abgelaufene Zeitgrenze).
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
  return { actor: null as Actor | null, Umleitung, scheitern: false };
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
vi.mock("@/lib/file-access", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/file-access")>();
  return {
    ...orig,
    deleteSpaceWithUploads: vi.fn(async (spaceId: string) => {
      if (mocks.scheitern) throw new Error("Transaction already closed");
      return orig.deleteSpaceWithUploads(spaceId);
    }),
  };
});

const { deleteSpaceAction } = await import("@/app/s/[slug]/settings/actions");

const TAG = `saud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const spaceIds: string[] = [];

async function umleitung(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (e) {
    if (e instanceof mocks.Umleitung) return e.url;
    throw e;
  }
}

async function spaceMitOwner(): Promise<{ id: string; name: string; slug: string }> {
  const n = spaceIds.length;
  const owner = await prisma.user.create({
    data: { email: `${TAG}-${n}@example.test`, name: "Owner", passwordHash: "x" },
    select: { id: true, email: true, name: true },
  });
  mocks.actor = { ...owner, isAdmin: false };
  const space = await prisma.space.create({
    data: {
      name: `${TAG}-${n}`,
      slug: `${TAG}-${n}`,
      members: { create: [{ userId: owner.id, role: "OWNER" }] },
    },
    select: { id: true, name: true, slug: true },
  });
  spaceIds.push(space.id);
  return space;
}

function formular(space: { name: string; slug: string }): FormData {
  const f = new FormData();
  f.set("slug", space.slug);
  f.set("confirm", space.name);
  return f;
}

beforeEach(() => {
  mocks.scheitern = false;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ targetId: { in: spaceIds } }, { spaceId: { in: spaceIds } }, { actor: { email: { startsWith: TAG } } }],
    },
  });
  await prisma.space.deleteMany({ where: { id: { in: spaceIds } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("deleteSpaceAction (Owner)", () => {
  it("laesst die Eintraege des Space stehen und schreibt space.deleted", async () => {
    const space = await spaceMitOwner();
    const vorher = await prisma.auditLog.create({
      data: {
        action: "member.role_changed",
        actorId: mocks.actor!.id,
        spaceId: space.id,
        targetId: `${TAG}-ziel`,
      },
      select: { id: true },
    });

    expect(await umleitung(deleteSpaceAction(undefined, formular(space)))).toBe(
      "/spaces",
    );

    expect(await prisma.space.count({ where: { id: space.id } })).toBe(0);
    const alt = await prisma.auditLog.findUnique({
      where: { id: vorher.id },
      select: { spaceId: true },
    });
    expect(alt).toEqual({ spaceId: null });
    const geloescht = await prisma.auditLog.findMany({
      where: { action: "space.deleted", targetId: space.id },
      select: { actorId: true, metadata: true },
    });
    expect(geloescht).toEqual([
      {
        actorId: mocks.actor!.id,
        metadata: { name: space.name, slug: space.slug },
      },
    ]);
  });

  it("schreibt keinen Eintrag, wenn die Loeschung scheitert", async () => {
    const space = await spaceMitOwner();
    mocks.scheitern = true;
    await expect(
      deleteSpaceAction(undefined, formular(space)),
    ).rejects.toThrow("Transaction already closed");
    expect(await prisma.space.count({ where: { id: space.id } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: "space.deleted", targetId: space.id },
      }),
    ).toBe(0);
  });
});
