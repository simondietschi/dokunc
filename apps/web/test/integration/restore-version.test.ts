import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Wiederherstellen einer Version, geprueft an der Action selbst: was sie
 * in die Datenbank schreibt, was sie dem Collab-Server mitgibt und wohin
 * sie je nach dessen Quittung umleitet.
 *
 * Wie in page-actions.test.ts laeuft die echte Action gegen die echte
 * Datenbank; ersetzt sind Anmeldung, Cache, Umleitung — und
 * requestDocumentReset, denn der Collab-Server laeuft hier nicht. Das
 * Warten auf die Quittung pruefen lib/collab-sync.test.ts und
 * apps/collab/src/doc-reset.test.ts, den ganzen Weg mit echtem
 * Collab-Server restore-version-collab.test.ts.
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
  return {
    actor: null as Actor | null,
    Umleitung,
    reset: vi.fn(
      async (_pageId: string, _versionId: string, _actorId: string) => true,
    ),
  };
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
vi.mock("@/lib/collab-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collab-sync")>()),
  requestDocumentReset: mocks.reset,
}));

const { restoreVersionAction } = await import("@/app/s/[slug]/actions");
const { RESTORE_STALE_PARAM } = await import("@/lib/collab-sync");

const TAG = `rver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function doc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

let spaceId: string;
let pageId: string;
let versionId: string;

async function umleitung(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (e) {
    if (e instanceof mocks.Umleitung) return e.url;
    throw e;
  }
}

function formular(): FormData {
  const f = new FormData();
  f.set("slug", TAG);
  f.set("versionId", versionId);
  return f;
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { email: `${TAG}-owner@example.test`, name: "Owner", passwordHash: "x" },
    select: { id: true, email: true, name: true },
  });
  mocks.actor = { ...owner, isAdmin: false };
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug: TAG,
        members: { create: [{ userId: owner.id, role: "OWNER" }] },
      },
      select: { id: true },
    })
  ).id;
  pageId = (
    await prisma.page.create({
      data: { spaceId, title: `${TAG}-seite`, content: doc("Neuer Stand") },
      select: { id: true },
    })
  ).id;
  versionId = (
    await prisma.pageVersion.create({
      data: {
        pageId,
        title: `${TAG}-seite`,
        content: doc("Alter Stand"),
        textContent: "Alter Stand",
      },
      select: { id: true },
    })
  ).id;
});

beforeEach(async () => {
  mocks.reset.mockReset();
  await prisma.page.update({
    where: { id: pageId },
    data: { content: doc("Neuer Stand"), textContent: "Neuer Stand" },
  });
  // Ein gespeicherter Yjs-Stand wie nach dem letzten Speicherlauf.
  await prisma.collabDocument.upsert({
    where: { pageId },
    create: { pageId, state: Buffer.from([0, 0]) },
    update: {},
  });
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("restoreVersionAction", () => {
  it("schreibt die Version, behaelt den Yjs-Stand und nennt dem Collab-Server Seite, Version und Person", async () => {
    mocks.reset.mockResolvedValue(true);
    const ziel = await umleitung(restoreVersionAction(formular()));

    // Die versionId geht mit: ohne sie haette der Collab-Server nach
    // einem dazwischengekommenen Speicherlauf keinen richtigen Stand mehr.
    // Die Person traegt er beim Speichern als Bearbeiter ein.
    expect(mocks.reset).toHaveBeenCalledWith(pageId, versionId, mocks.actor!.id);
    const page = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { content: true, textContent: true },
    });
    expect(page.content).toEqual(doc("Alter Stand"));
    expect(page.textContent).toBe("Alter Stand");
    // Der Collab-Server tauscht auf dieser Linie aus und hat sie
    // gespeichert; verworfen haette sie jede Kopie im Browser zu einer
    // fremden Linie gemacht, deren alter Text beim Verbinden zurueckkaeme.
    expect(await prisma.collabDocument.count({ where: { pageId } })).toBe(1);
    // Bestaetigt: kein Warnhinweis.
    expect(ziel).toBe(`/s/${TAG}/p/${pageId}`);
  });

  it("leitet mit Warnhinweis um und verwirft den Yjs-Stand, wenn der Collab-Server nicht bestaetigt", async () => {
    mocks.reset.mockResolvedValue(false);
    const ziel = await umleitung(restoreVersionAction(formular()));
    expect(ziel).toBe(`/s/${TAG}/p/${pageId}?${RESTORE_STALE_PARAM}=${versionId}`);
    // Der Stand ist trotzdem geschrieben — genau das sagt der Hinweis.
    const page = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { content: true },
    });
    expect(page.content).toEqual(doc("Alter Stand"));
    // Rueckfall: ohne gespeicherten Yjs-Stand baut der naechste Start das
    // Dokument wenigstens aus Page.content.
    expect(await prisma.collabDocument.count({ where: { pageId } })).toBe(0);
  });

  // Die Quittung kommt erst nach dem Schreiben: sonst setzte der
  // Collab-Server das Dokument auf einen Stand, den die Datenbank noch
  // nicht hat. Und der Yjs-Stand muss dann noch da sein — der
  // Collab-Server laedt das Dokument fuer den Austausch daraus.
  it("fragt den Collab-Server erst, wenn die Version geschrieben ist, und laesst ihm den Yjs-Stand", async () => {
    mocks.reset.mockImplementation(async () => {
      const page = await prisma.page.findUniqueOrThrow({
        where: { id: pageId },
        select: { content: true },
      });
      expect(page.content).toEqual(doc("Alter Stand"));
      expect(await prisma.collabDocument.count({ where: { pageId } })).toBe(1);
      return true;
    });
    await umleitung(restoreVersionAction(formular()));
    expect(mocks.reset).toHaveBeenCalledTimes(1);
  });
});
