import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";
import {
  findLivePage,
  isDescendantOf,
  movePageInSpace,
  findRestorableVersion,
  findTrashedPage,
  renamePageInSpace,
  resolveParentId,
  restorePageTree,
  trashPageTree,
  type PageScope,
} from "@/lib/page-guards";
import { findReadableAttachment } from "@/lib/file-access";

/**
 * Der Kern der Autorisierung dieser App: eine Seiten- oder Versions-ID
 * aus einem Formular darf niemals einen Space treffen, in dem die
 * handelnde Person nichts darf. Genau das wird hier gegen eine echte
 * Datenbank geprüft — mit zwei Spaces und einem Nutzer, der nur in
 * einem davon Mitglied ist.
 */

const TAG = `authz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let insider: { id: string };
/** Kontext, wie ihn eine Server-Action an die Guards weiterreicht. */
let homeScope: PageScope;
let outsideScope: PageScope;
let outsiderSpaceId: string;
let homeSpaceId: string;
let homePageId: string;
let homeChildId: string;
let foreignPageId: string;
let foreignVersionId: string;
let homeVersionId: string;
let foreignUploadName: string;
let homeUploadName: string;

beforeAll(async () => {
  insider = await prisma.user.create({
    data: {
      email: `${TAG}@example.test`,
      name: "Insider",
      passwordHash: "x",
    },
    select: { id: true },
  });

  const home = await prisma.space.create({
    data: {
      name: `${TAG}-home`,
      slug: `${TAG}-home`,
      members: { create: { userId: insider.id, role: "MEMBER" } },
    },
  });
  homeSpaceId = home.id;

  // Space ohne Mitgliedschaft des Nutzers.
  const foreign = await prisma.space.create({
    data: { name: `${TAG}-foreign`, slug: `${TAG}-foreign` },
  });
  outsiderSpaceId = foreign.id;

  const homePage = await prisma.page.create({
    data: { spaceId: homeSpaceId, title: "Zuhause" },
  });
  homePageId = homePage.id;
  const child = await prisma.page.create({
    data: { spaceId: homeSpaceId, parentId: homePageId, title: "Unterseite" },
  });
  homeChildId = child.id;

  const foreignPage = await prisma.page.create({
    data: { spaceId: outsiderSpaceId, title: "Fremd" },
  });
  foreignPageId = foreignPage.id;

  const foreignVersion = await prisma.pageVersion.create({
    data: { pageId: foreignPageId, title: "Fremde Fassung" },
  });
  foreignVersionId = foreignVersion.id;
  const homeVersion = await prisma.pageVersion.create({
    data: { pageId: homePageId, title: "Eigene Fassung" },
  });
  homeVersionId = homeVersion.id;

  foreignUploadName = `${TAG}-foreign.png`;
  homeUploadName = `${TAG}-home.png`;
  await prisma.attachment.createMany({
    data: [
      {
        storedName: foreignUploadName,
        name: foreignUploadName,
        spaceId: outsiderSpaceId,
        mimeType: "image/png",
        size: 1,
      },
      {
        storedName: homeUploadName,
        name: homeUploadName,
        spaceId: homeSpaceId,
        uploaderId: insider.id,
        mimeType: "image/png",
        size: 1,
      },
    ],
  });

  homeScope = { spaceId: homeSpaceId, userId: insider.id, role: "MEMBER" };
  outsideScope = {
    spaceId: outsiderSpaceId,
    userId: insider.id,
    role: "MEMBER",
  };
});

afterAll(async () => {
  await prisma.space.deleteMany({
    where: { id: { in: [homeSpaceId, outsiderSpaceId] } },
  });
  await prisma.user.deleteMany({ where: { id: insider.id } });
});

describe("Seitenzugriff über Space-Grenzen", () => {
  it("findet die eigene Seite", async () => {
    expect(await findLivePage(homeScope, homePageId)).not.toBeNull();
  });

  it("findet eine fremde Seite nicht", async () => {
    expect(await findLivePage(homeScope, foreignPageId)).toBeNull();
  });

  it("benennt eine fremde Seite nicht um", async () => {
    const renamed = await renamePageInSpace(
      homeScope,
      foreignPageId,
      "gekapert",
    );
    expect(renamed).toBe(false);

    const untouched = await prisma.page.findUnique({
      where: { id: foreignPageId },
      select: { title: true },
    });
    expect(untouched?.title).toBe("Fremd");
  });

  it("benennt die eigene Seite um", async () => {
    expect(await renamePageInSpace(homeScope, homePageId, "Neu")).toBe(true);
    const page = await prisma.page.findUnique({
      where: { id: homePageId },
      select: { title: true },
    });
    expect(page?.title).toBe("Neu");
  });

  it("legt eine fremde Seite nicht in den Papierkorb", async () => {
    await trashPageTree(homeSpaceId, foreignPageId);
    const page = await prisma.page.findUnique({
      where: { id: foreignPageId },
      select: { deletedAt: true },
    });
    expect(page?.deletedAt).toBeNull();
  });

  it("nimmt beim Löschen und Wiederherstellen den Unterbaum mit", async () => {
    await trashPageTree(homeSpaceId, homePageId);
    const trashed = await prisma.page.findMany({
      where: { id: { in: [homePageId, homeChildId] } },
      select: { deletedAt: true },
    });
    expect(trashed.every((p) => p.deletedAt !== null)).toBe(true);

    expect(await findTrashedPage(homeScope, homePageId)).not.toBeNull();
    expect(await findTrashedPage(outsideScope, homePageId)).toBeNull();

    await restorePageTree(homeSpaceId, homePageId);
    const restored = await prisma.page.findMany({
      where: { id: { in: [homePageId, homeChildId] } },
      select: { deletedAt: true },
    });
    expect(restored.every((p) => p.deletedAt === null)).toBe(true);
  });
});

describe("Versionswiederherstellung über Space-Grenzen", () => {
  it("findet die eigene Version", async () => {
    const v = await findRestorableVersion(homeScope, homeVersionId);
    expect(v?.pageId).toBe(homePageId);
  });

  it("findet eine fremde Version nicht", async () => {
    expect(
      await findRestorableVersion(homeScope, foreignVersionId),
    ).toBeNull();
  });
});

describe("Elternseite beim Anlegen", () => {
  it("erlaubt eine Elternseite aus demselben Space", async () => {
    expect(await resolveParentId(homeScope, homePageId)).toBe(homePageId);
  });

  it("lässt keine Elternseite ohne Angabe entstehen", async () => {
    expect(await resolveParentId(homeScope, null)).toBeNull();
  });

  it("weist eine fremde Elternseite ab", async () => {
    await expect(
      resolveParentId(homeScope, foreignPageId),
    ).rejects.toThrow();
  });
});

describe("Dateiauslieferung", () => {
  it("liefert eine Datei des eigenen Space", async () => {
    const att = await findReadableAttachment(homeUploadName, insider.id);
    expect(att?.storedName).toBe(homeUploadName);
  });

  it("liefert keine Datei eines fremden Space", async () => {
    expect(
      await findReadableAttachment(foreignUploadName, insider.id),
    ).toBeNull();
  });

  it("liefert nichts ohne Nutzer", async () => {
    expect(await findReadableAttachment(homeUploadName, "")).toBeNull();
  });
});

describe("Seiten im Baum verschieben", () => {
  it("erkennt Nachfahren", async () => {
    expect(await isDescendantOf(homeSpaceId, homePageId, homeChildId)).toBe(
      true,
    );
    expect(await isDescendantOf(homeSpaceId, homeChildId, homePageId)).toBe(
      false,
    );
    // Eine Seite ist ihr eigener Nachfahre — sonst liesse sie sich unter
    // sich selbst hängen.
    expect(await isDescendantOf(homeSpaceId, homePageId, homePageId)).toBe(
      true,
    );
  });

  it("verweigert einen Zug unter die eigene Unterseite", async () => {
    // Würde den ganzen Ast vom Baum abschneiden.
    expect(
      await movePageInSpace(homeScope, homePageId, homeChildId, 0),
    ).toBe(false);
  });

  it("verweigert einen Zug in einen fremden Space", async () => {
    expect(
      await movePageInSpace(homeScope, foreignPageId, homePageId, 0),
    ).toBe(false);
    expect(
      await movePageInSpace(homeScope, homePageId, foreignPageId, 0),
    ).toBe(false);
  });

  it("hängt eine Seite um und schreibt die Reihenfolge neu", async () => {
    const second = await prisma.page.create({
      data: { spaceId: homeSpaceId, title: "Zweite" },
    });
    try {
      // Unterseite auf die oberste Ebene, an den Anfang.
      expect(await movePageInSpace(homeScope, homeChildId, null, 0)).toBe(
        true,
      );
      const roots = await prisma.page.findMany({
        where: { spaceId: homeSpaceId, parentId: null, deletedAt: null },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });
      expect(roots[0].id).toBe(homeChildId);
      expect(roots.map((r) => r.position)).toEqual(
        roots.map((_, i) => i),
      );

      // Und wieder zurück unter die Ausgangsseite.
      expect(
        await movePageInSpace(homeScope, homeChildId, homePageId, 0),
      ).toBe(true);
      const child = await prisma.page.findUnique({
        where: { id: homeChildId },
        select: { parentId: true },
      });
      expect(child?.parentId).toBe(homePageId);
    } finally {
      await prisma.page.delete({ where: { id: second.id } });
    }
  });
});
