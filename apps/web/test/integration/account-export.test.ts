import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";
import { setPageRestricted } from "@/lib/page-access";

/**
 * Datenauskunft (GET /api/account/export): Titel nur fuer Seiten, die die
 * Person heute oeffnen darf.
 *
 * Favoriten, Abos, Kommentare und Versionen verweisen auf Seiten. Wurde
 * eine davon inzwischen vor der Person geschuetzt, geloescht oder hat sie
 * den Space verlassen, lieferte die Auskunft trotzdem den aktuellen Titel,
 * auch nach einer Umbenennung durch andere. Fuer solche Seiten stehen nur
 * die ID und der Hinweis "Seite ohne Zugriff" darin.
 *
 * Echte Route und Datenbank; ersetzt sind Anmeldung und Anfrage-Header
 * (fuer die Adresse im Audit-Eintrag).
 */

const hooks = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string; isAdmin: boolean } | null,
}));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => hooks.user),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const { GET } = await import("@/app/api/account/export/route");

const TAG = `auskunft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const GEHEIM = `Geheimer Titel ${TAG}`;
const UMBENANNT = `Umbenannt ${TAG}`;
const VERLASSEN = `Verlassener Space ${TAG}`;
const OFFEN = `Offene Seite ${TAG}`;

let ich: { id: string; email: string; name: string; isAdmin: boolean };
let andere: { id: string };
let space: string;
let fremderSpace: string;
let offen: string;
let geschuetzt: string;
let imVerlassenen: string;

async function konto(name: string) {
  return prisma.user.create({
    data: { email: `${TAG}-${name}@example.test`, name, passwordHash: "x" },
    select: { id: true, email: true, name: true, isAdmin: true },
  });
}

/** Alles, was die Person an einer Seite hat: Favorit, Abo, Kommentar, Version. */
async function spuren(pageId: string, title: string) {
  await prisma.favorite.create({ data: { userId: ich.id, pageId } });
  await prisma.pageSubscription.create({ data: { userId: ich.id, pageId } });
  await prisma.comment.create({
    data: { pageId, authorId: ich.id, body: `Kommentar zu ${pageId}` },
  });
  await prisma.pageVersion.create({ data: { pageId, authorId: ich.id, title } });
}

beforeAll(async () => {
  ich = await konto("ich");
  andere = await konto("andere");
  space = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug: TAG,
        members: {
          create: [
            { userId: ich.id, role: "MEMBER" },
            { userId: andere.id, role: "ADMIN" },
          ],
        },
      },
      select: { id: true },
    })
  ).id;
  fremderSpace = (
    await prisma.space.create({
      data: {
        name: `${TAG}-verlassen`,
        slug: `${TAG}-verlassen`,
        members: { create: [{ userId: ich.id, role: "MEMBER" }] },
      },
      select: { id: true },
    })
  ).id;
  offen = (await prisma.page.create({ data: { spaceId: space, title: OFFEN } })).id;
  geschuetzt = (await prisma.page.create({ data: { spaceId: space, title: GEHEIM } })).id;
  imVerlassenen = (
    await prisma.page.create({ data: { spaceId: fremderSpace, title: VERLASSEN } })
  ).id;
  for (const [id, t] of [
    [offen, OFFEN],
    [geschuetzt, GEHEIM],
    [imVerlassenen, VERLASSEN],
  ] as const) {
    await spuren(id, t);
  }
  // Danach: geschuetzt ohne Freigabe fuer mich und umbenannt, und ich
  // verlasse den zweiten Space.
  await setPageRestricted(geschuetzt, true, andere.id);
  await prisma.page.update({ where: { id: geschuetzt }, data: { title: UMBENANNT } });
  await prisma.spaceMember.deleteMany({ where: { userId: ich.id, spaceId: fremderSpace } });
  hooks.user = ich;
}, 60_000);

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: { in: [space, fremderSpace] } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

type Seitenangabe = { id: string; title: string | null; note?: string };

async function auskunft() {
  const res = await GET();
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, daten: JSON.parse(text) as Record<string, unknown> };
}

describe("GET /api/account/export: Titel nur fuer sichtbare Seiten", () => {
  it("nennt keinen Titel einer Seite, die die Person nicht mehr oeffnen darf", async () => {
    const { text } = await auskunft();
    expect(text).not.toContain(UMBENANNT);
    expect(text).not.toContain(GEHEIM);
    expect(text).not.toContain(VERLASSEN);
  });

  it("ID und Hinweis statt des Titels, der Titel sichtbarer Seiten bleibt", async () => {
    const { daten } = await auskunft();
    const seiten = (liste: unknown) =>
      new Map(
        (liste as { page: Seitenangabe }[]).map((e) => [e.page.id, e.page] as const),
      );
    for (const art of ["favorites", "subscriptions", "comments"] as const) {
      const m = seiten(daten[art]);
      expect(m.get(offen), art).toEqual({ id: offen, title: OFFEN });
      for (const weg of [geschuetzt, imVerlassenen]) {
        expect(m.get(weg), art).toEqual({ id: weg, title: null, note: "Seite ohne Zugriff" });
      }
    }
    const versionen = daten.pageVersions as { title: string | null; page: Seitenangabe }[];
    const zuOffen = versionen.find((v) => v.page.id === offen);
    expect(zuOffen?.title).toBe(OFFEN);
    const zuGeschuetzt = versionen.find((v) => v.page.id === geschuetzt);
    expect(zuGeschuetzt?.title).toBeNull();
    expect(zuGeschuetzt?.page).toEqual({ id: geschuetzt, title: null, note: "Seite ohne Zugriff" });
  });

  it("die eigenen Texte bleiben vollstaendig", async () => {
    const { daten } = await auskunft();
    const bodies = (daten.comments as { body: string }[]).map((c) => c.body).sort();
    expect(bodies).toEqual(
      [offen, geschuetzt, imVerlassenen].map((id) => `Kommentar zu ${id}`).sort(),
    );
  });
});
