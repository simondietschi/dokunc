import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";
import { refreshAccessRoots, setPageRestricted } from "@/lib/page-access";
import { subtreeHasHiddenPages } from "@/lib/page-guards";

/**
 * Verborgene Unterseiten beim Loeschen.
 *
 * Wer eine offene Seite in den Papierkorb legt oder endgueltig loescht,
 * nimmt ihren ganzen Unterbaum mit. Liegt darin eine geschuetzte Seite,
 * die die Person nicht sehen darf, muss die Aktion abbrechen — sonst
 * loescht jemand, was er nicht einmal kennt.
 *
 * Diese Pruefung hing an einer Verneinung von visiblePageSql, und die
 * war wirkungslos: bei leerer Liste der offenen Spaces stand darin
 * `spaceId IN (NULL)`, das ergibt NULL, und `NOT NULL` bleibt NULL. Die
 * geschuetzte Unterseite zaehlte nie als verborgen. Der erste Fall hier
 * faellt deshalb ohne die Korrektur in page-access.ts.
 */

const TAG = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let spaceId: string;
let fremd: string;
let eingetragen: string;
let offenId: string;
let geschuetztId: string;

async function person(suffix: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `${TAG}-${suffix}@example.test`, name: suffix, passwordHash: "x" },
    select: { id: true },
  });
  return u.id;
}

beforeAll(async () => {
  [fremd, eingetragen] = await Promise.all([person("fremd"), person("eingetragen")]);
  const space = await prisma.space.create({
    data: {
      name: `${TAG}-space`,
      slug: `${TAG}-space`,
      members: {
        create: [
          { userId: fremd, role: "MEMBER" },
          { userId: eingetragen, role: "MEMBER" },
        ],
      },
    },
    select: { id: true },
  });
  spaceId = space.id;
  const offen = await prisma.page.create({
    data: { spaceId, title: "Offen" },
    select: { id: true },
  });
  offenId = offen.id;
  const geschuetzt = await prisma.page.create({
    data: { spaceId, parentId: offenId, title: "Geschuetzt darunter" },
    select: { id: true },
  });
  geschuetztId = geschuetzt.id;
  // Die schuetzende Person wird automatisch eingetragen.
  await setPageRestricted(geschuetztId, true, eingetragen);
  await refreshAccessRoots(geschuetztId);
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: { in: [fremd, eingetragen] } } });
});

describe("subtreeHasHiddenPages()", () => {
  it("meldet eine geschuetzte Unterseite ohne Freigabe als verborgen", async () => {
    // Genau der Fall, an dem die Verneinung an NULL zerschellte.
    expect(
      await subtreeHasHiddenPages({ spaceId, userId: fremd, role: "MEMBER" }, offenId),
    ).toBe(true);
  });

  it("laesst durch, wer auf der geschuetzten Seite eingetragen ist", async () => {
    expect(
      await subtreeHasHiddenPages(
        { spaceId, userId: eingetragen, role: "MEMBER" },
        offenId,
      ),
    ).toBe(false);
  });

  it("laesst die Verwaltung durch, die ohnehin alles sieht", async () => {
    expect(
      await subtreeHasHiddenPages({ spaceId, userId: fremd, role: "ADMIN" }, offenId),
    ).toBe(false);
  });

  it("meldet nichts fuer einen Unterbaum ohne geschuetzte Seite", async () => {
    const blatt = await prisma.page.create({
      data: { spaceId, title: "Ohne Kinder" },
      select: { id: true },
    });
    expect(
      await subtreeHasHiddenPages({ spaceId, userId: fremd, role: "MEMBER" }, blatt.id),
    ).toBe(false);
  });
});
