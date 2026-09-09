import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";
import {
  findLivePage,
  findRestorableVersion,
  findTrashedPage,
  renamePageInSpace,
  resolveParentId,
  restorePageTree,
  trashPageTree,
} from "@/lib/page-guards";
import { findReadableUpload } from "@/lib/upload-access";

/**
 * Der Kern der Autorisierung dieser App: eine Seiten- oder Versions-ID
 * aus einem Formular darf niemals einen Space treffen, in dem die
 * handelnde Person nichts darf. Genau das wird hier gegen eine echte
 * Datenbank geprüft — mit zwei Spaces und einem Nutzer, der nur in
 * einem davon Mitglied ist.
 */

const TAG = `authz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let insider: { id: string };
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
  await prisma.upload.createMany({
    data: [
      {
        filename: foreignUploadName,
        spaceId: outsiderSpaceId,
        contentType: "image/png",
        size: 1,
      },
      {
        filename: homeUploadName,
        spaceId: homeSpaceId,
        uploaderId: insider.id,
        contentType: "image/png",
        size: 1,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.space.deleteMany({
    where: { id: { in: [homeSpaceId, outsiderSpaceId] } },
  });
  await prisma.user.deleteMany({ where: { id: insider.id } });
});

describe("Seitenzugriff über Space-Grenzen", () => {
  it("findet die eigene Seite", async () => {
    expect(await findLivePage(homeSpaceId, homePageId)).not.toBeNull();
  });

  it("findet eine fremde Seite nicht", async () => {
    expect(await findLivePage(homeSpaceId, foreignPageId)).toBeNull();
  });

  it("benennt eine fremde Seite nicht um", async () => {
    const renamed = await renamePageInSpace(
      homeSpaceId,
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
    expect(await renamePageInSpace(homeSpaceId, homePageId, "Neu")).toBe(true);
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

    expect(await findTrashedPage(homeSpaceId, homePageId)).not.toBeNull();
    expect(await findTrashedPage(outsiderSpaceId, homePageId)).toBeNull();

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
    const v = await findRestorableVersion(homeSpaceId, homeVersionId);
    expect(v?.pageId).toBe(homePageId);
  });

  it("findet eine fremde Version nicht", async () => {
    expect(
      await findRestorableVersion(homeSpaceId, foreignVersionId),
    ).toBeNull();
  });
});

describe("Elternseite beim Anlegen", () => {
  it("erlaubt eine Elternseite aus demselben Space", async () => {
    expect(await resolveParentId(homeSpaceId, homePageId)).toBe(homePageId);
  });

  it("lässt keine Elternseite ohne Angabe entstehen", async () => {
    expect(await resolveParentId(homeSpaceId, null)).toBeNull();
  });

  it("weist eine fremde Elternseite ab", async () => {
    await expect(
      resolveParentId(homeSpaceId, foreignPageId),
    ).rejects.toThrow();
  });
});

describe("Dateiauslieferung", () => {
  it("liefert eine Datei des eigenen Space", async () => {
    const up = await findReadableUpload(insider.id, homeUploadName);
    expect(up?.filename).toBe(homeUploadName);
  });

  it("liefert keine Datei eines fremden Space", async () => {
    expect(
      await findReadableUpload(insider.id, foreignUploadName),
    ).toBeNull();
  });

  it("liefert nichts ohne Nutzer", async () => {
    expect(await findReadableUpload("", homeUploadName)).toBeNull();
  });
});
