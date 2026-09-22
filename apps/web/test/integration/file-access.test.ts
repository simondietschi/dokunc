import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@dokunc/db";
import { setPageRestricted } from "@/lib/page-access";
import { findReadableAttachment } from "@/lib/file-access";

/**
 * Anhänge ohne Seitenbezug.
 *
 * Sie stammen aus älteren Uploads (der Editor schickte eine Zeit lang
 * keine pageId mit, auch aus geschützten Seiten) oder aus endgültig
 * gelöschten Seiten (ON DELETE SET NULL). Früher bekam sie jede Person
 * mit Zugang zum Space, die den Dateinamen kannte — also auch die
 * Bilder geschützter Seiten. Jetzt entscheiden die Seiten, die die
 * Datei verwenden: lesbar nur, wenn es solche Seiten gibt und die
 * Person jede davon sehen darf.
 */

const TAG = `fa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let spaceId: string;
let otherSpaceId: string;
/** Hat die geschützte Seite geschützt und steht damit selbst drin. */
let owner: string;
/** Mitglied ohne Freigabe auf die geschützte Seite. */
let member: string;
/** Verwaltung des Space. */
let manager: string;

/** Dateinamen, je einer pro Fall. */
const datei = {
  offen: `${TAG}-offen.png`,
  titelbild: `${TAG}-titelbild.png`,
  version: `${TAG}-version.png`,
  geheim: `${TAG}-geheim.png`,
  beides: `${TAG}-beides.png`,
  papierkorb: `${TAG}-papierkorb.png`,
  verwaist: `${TAG}-verwaist.png`,
  fremderSpace: `${TAG}-fremder-space.png`,
  gebunden: `${TAG}-gebunden.png`,
};

/** Inhalt, wie der Editor ihn speichert: Bildknoten mit /api/files-URL. */
function docMit(...namen: string[]): Prisma.InputJsonValue {
  return {
    type: "doc",
    content: namen.map((n) => ({
      type: "image",
      attrs: { src: `/api/files/${n}`, alt: n },
    })),
  };
}

async function makeUser(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash: "x",
    },
    select: { id: true },
  });
  return user.id;
}

beforeAll(async () => {
  [owner, member, manager] = await Promise.all([
    makeUser("owner"),
    makeUser("member"),
    makeUser("manager"),
  ]);

  const space = await prisma.space.create({
    data: {
      name: `${TAG}-space`,
      slug: `${TAG}-space`,
      members: {
        create: [
          { userId: owner, role: "MEMBER" },
          { userId: member, role: "MEMBER" },
          { userId: manager, role: "ADMIN" },
        ],
      },
    },
    select: { id: true },
  });
  spaceId = space.id;

  // Zweiter Space, in dem das Mitglied ebenfalls Zugang hat: ein Verweis
  // von dort darf eine Datei dieses Space nicht freischalten.
  const other = await prisma.space.create({
    data: {
      name: `${TAG}-other`,
      slug: `${TAG}-other`,
      members: { create: [{ userId: member, role: "MEMBER" }] },
    },
    select: { id: true },
  });
  otherSpaceId = other.id;

  const offen = await prisma.page.create({
    data: {
      spaceId,
      title: "Offen",
      content: docMit(datei.offen, datei.beides),
      coverUrl: `/api/files/${datei.titelbild}`,
    },
    select: { id: true },
  });
  // Nur noch in einer älteren Fassung der offenen Seite.
  await prisma.pageVersion.create({
    data: {
      pageId: offen.id,
      title: "Offen, früher",
      content: docMit(datei.version),
    },
  });

  const geheim = await prisma.page.create({
    data: {
      spaceId,
      title: "Geheim",
      content: docMit(datei.geheim, datei.beides),
    },
    select: { id: true },
  });
  await setPageRestricted(geheim.id, true, owner);

  // Geschützt und im Papierkorb: bleibt verborgen, wie bei canSeePage.
  const geheimImKorb = await prisma.page.create({
    data: {
      spaceId,
      title: "Geheim im Papierkorb",
      content: docMit(datei.papierkorb),
    },
    select: { id: true },
  });
  await setPageRestricted(geheimImKorb.id, true, owner);
  await prisma.page.update({
    where: { id: geheimImKorb.id },
    data: { deletedAt: new Date() },
  });

  await prisma.page.create({
    data: {
      spaceId: otherSpaceId,
      title: "Anderswo",
      content: docMit(datei.fremderSpace),
    },
  });

  await prisma.attachment.createMany({
    data: Object.values(datei).map((storedName) => ({
      storedName,
      name: storedName,
      spaceId,
      // Nur dieser eine hängt an einer Seite: die bestehende Regel für
      // Anhänge mit Seitenbezug bleibt, wie sie ist.
      pageId: storedName === datei.gebunden ? geheim.id : null,
      mimeType: "image/png",
      size: 1,
    })),
  });
});

afterAll(async () => {
  await prisma.space.deleteMany({
    where: { id: { in: [spaceId, otherSpaceId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [owner, member, manager] } },
  });
});

async function liest(userId: string, name: string): Promise<boolean> {
  return (await findReadableAttachment(name, userId)) !== null;
}

describe("Anhang ohne Seitenbezug", () => {
  it("bleibt in einer offenen Seite für alle lesbar", async () => {
    expect(await liest(member, datei.offen)).toBe(true);
  });

  it("bleibt als Titelbild einer offenen Seite lesbar", async () => {
    expect(await liest(member, datei.titelbild)).toBe(true);
  });

  it("bleibt aus einer älteren Fassung einer offenen Seite lesbar", async () => {
    expect(await liest(member, datei.version)).toBe(true);
  });

  it("gibt das Bild einer geschützten Seite nur ihren Eingetragenen", async () => {
    expect(await liest(member, datei.geheim)).toBe(false);
    expect(await liest(owner, datei.geheim)).toBe(true);
  });

  it("lässt sich nicht über eine zusätzliche offene Seite freischalten", async () => {
    // Dieselbe Datei steckt in der offenen und in der geschützten Seite:
    // ohne Seitenbezug ist nicht zu sagen, woher sie stammt.
    expect(await liest(member, datei.beides)).toBe(false);
    expect(await liest(owner, datei.beides)).toBe(true);
  });

  it("zählt eine geschützte Seite im Papierkorb mit", async () => {
    expect(await liest(member, datei.papierkorb)).toBe(false);
    expect(await liest(owner, datei.papierkorb)).toBe(true);
  });

  it("gibt eine Datei, die keine Seite verwendet, nicht heraus", async () => {
    expect(await liest(member, datei.verwaist)).toBe(false);
    expect(await liest(owner, datei.verwaist)).toBe(false);
  });

  it("zählt nur Seiten aus dem Space des Anhangs", async () => {
    expect(await liest(member, datei.fremderSpace)).toBe(false);
  });

  it("lässt die Space-Verwaltung durch", async () => {
    expect(await liest(manager, datei.geheim)).toBe(true);
    expect(await liest(manager, datei.verwaist)).toBe(true);
  });
});

describe("Anhang mit Seitenbezug", () => {
  it("folgt weiter allein der Sichtbarkeit seiner Seite", async () => {
    expect(await liest(member, datei.gebunden)).toBe(false);
    expect(await liest(owner, datei.gebunden)).toBe(true);
  });
});
