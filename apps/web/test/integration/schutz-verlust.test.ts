import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Seitenschutz auf den Wegen, die eine Seite neu entstehen lassen oder
 * umhängen: Kopie, Seite aus Vorlage.
 *
 * Geprüft wird die echte Action gegen die echte Datenbank, als Person
 * der Welt aus der Rechtematrix (rechtematrix-welt.ts). Ersetzt sind nur
 * Anmeldung, Anfrage-Header, Cache und die Umleitung.
 *
 * Nicht nur `isRestricted` und die Freigaben: eine Kopie, deren
 * `accessRootId` nicht nachgezogen ist, gilt für `visiblePageWhere` als
 * offen. Deshalb prüft jeder Fall auch die wirksame Wurzel und die
 * Sicht eines MEMBER ohne Freigabe.
 */

vi.mock("next/navigation", async (importOriginal) => {
  const { Umleitung } = await import("./rechtematrix-welt");
  return {
    ...(await importOriginal<typeof import("next/navigation")>()),
    redirect: vi.fn((url: string) => {
      throw new Umleitung(url);
    }),
  };
});
vi.mock("@/lib/current-user", async (importOriginal) => {
  const { Umleitung, currentUserAttrappe } = await import("./rechtematrix-welt");
  return {
    ...(await importOriginal<typeof import("@/lib/current-user")>()),
    ...currentUserAttrappe((url) => {
      throw new Umleitung(url);
    }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/headers", async () =>
  (await import("./rechtematrix-welt")).headersAttrappe(),
);

const { baueWelt, raeumeWelt, Umleitung } = await import("./rechtematrix-welt");
const { createPageAction } = await import("@/app/s/[slug]/actions");
const { createFromTemplateAction, duplicatePageAction } = await import(
  "@/app/s/[slug]/template-actions"
);
const { readablePageRole, setPageRestricted } = await import("@/lib/page-access");

type Welt = Awaited<ReturnType<typeof baueWelt>>;
type Person = Welt["personen"]["OWNER"];

let w: Welt;
beforeAll(async () => {
  w = await baueWelt();
}, 60_000);
afterEach(async () => {
  await w.aufraeumen();
});
afterAll(async () => {
  await raeumeWelt(w);
});

function formular(felder: Record<string, string>): FormData {
  const f = new FormData();
  f.set("slug", w.space.slug);
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

/** ID der Seite, auf die die Action umleitet (die neue Seite). */
async function neueSeite(p: Person, lauf: () => Promise<unknown>): Promise<string> {
  try {
    await w.alsPerson(p, lauf);
  } catch (e) {
    if (e instanceof Umleitung && e.url.includes("/p/")) {
      return e.url.slice(e.url.lastIndexOf("/p/") + 3);
    }
    throw e;
  }
  throw new Error("Die Action hat nicht auf eine neue Seite umgeleitet");
}

async function seite(
  titel: string,
  o: { parentId?: string; isTemplate?: boolean; text?: string } = {},
): Promise<string> {
  const text = o.text ?? `Inhalt von ${titel}`;
  const p = await prisma.page.create({
    data: {
      spaceId: w.space.id,
      parentId: o.parentId ?? null,
      title: titel,
      isTemplate: o.isTemplate ?? false,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
      textContent: text,
    },
    select: { id: true },
  });
  return p.id;
}

async function zeile(id: string) {
  return prisma.page.findUniqueOrThrow({
    where: { id },
    select: {
      title: true,
      parentId: true,
      isRestricted: true,
      accessRootId: true,
      textContent: true,
    },
  });
}

async function grants(pageId: string): Promise<string[]> {
  const g = await prisma.pageGrant.findMany({
    where: { pageId },
    select: { userId: true, groupId: true },
  });
  return g.map((x) => (x.userId ? `u:${x.userId}` : `g:${x.groupId}`)).sort();
}

async function sieht(p: Person, pageId: string): Promise<boolean> {
  return (await readablePageRole(p.id, pageId, w.space.id)) !== null;
}

async function carried(targetId: string) {
  return prisma.auditLog.findMany({
    where: { action: "page.protection_carried", targetId },
    select: { actorId: true, spaceId: true, metadata: true },
  });
}

/** Kind einer Kopie mit diesem Titel (die Kopie legt Unterseiten mit gleichem Titel an). */
async function kindMitTitel(parentId: string, title: string): Promise<string> {
  return (
    await prisma.page.findFirstOrThrow({
      where: { parentId, title },
      select: { id: true },
    })
  ).id;
}

describe("Kopie", () => {
  it("die Kopie einer geschützten Wurzel ist selbst Wurzel mit denselben Freigaben, auch für Gruppen", async () => {
    const { MEMBER, MEMBER_FREIGABE } = w.personen;
    const inGruppe = await w.neuePerson();
    await prisma.spaceMember.create({
      data: { spaceId: w.space.id, userId: inGruppe.id, role: "MEMBER" },
    });
    const gruppe = await prisma.group.create({
      data: {
        name: `${w.space.slug}-kopie-gruppe`,
        members: { create: [{ userId: inGruppe.id }] },
      },
      select: { id: true },
    });
    w.spaeter(() => prisma.group.deleteMany({ where: { id: gruppe.id } }));
    const p = await seite("Personalakte");
    await w.schuetze(p);
    await prisma.pageGrant.create({ data: { pageId: p, groupId: gruppe.id } });

    const kopie = await neueSeite(MEMBER_FREIGABE, () =>
      duplicatePageAction(formular({ pageId: p })),
    );

    const k = await zeile(kopie);
    expect(k.isRestricted).toBe(true);
    expect(k.accessRootId).toBe(kopie);
    expect(await grants(kopie)).toEqual(await grants(p));
    expect(await grants(kopie)).toContain(`g:${gruppe.id}`);
    expect(await sieht(MEMBER, kopie)).toBe(false);
    expect(await sieht(MEMBER_FREIGABE, kopie)).toBe(true);
    expect(await sieht(inGruppe, kopie)).toBe(true);

    const audit = await carried(kopie);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: MEMBER_FREIGABE.id,
      spaceId: w.space.id,
      metadata: { via: "copy", fromRootId: p, sourcePageId: p, grants: 4 },
    });
  });

  it("ein Ast mit zwei verschachtelten Wurzeln: jede kopierte Wurzel trägt die Freigaben ihrer Quelle", async () => {
    const { ADMIN, MEMBER, MEMBER_FREIGABE, OWNER } = w.personen;
    const nurR2 = await w.neuePerson();
    await prisma.spaceMember.create({
      data: { spaceId: w.space.id, userId: nurR2.id, role: "MEMBER" },
    });
    const a = await seite("Ast");
    const r1 = await seite("Wurzel eins", { parentId: a });
    const b = await seite("Mitte", { parentId: r1 });
    const r2 = await seite("Wurzel zwei", { parentId: b });
    const c = await seite("Blatt", { parentId: r2 });
    await w.schuetze(r1);
    await setPageRestricted(r2, true, OWNER.id);
    await prisma.pageGrant.create({ data: { pageId: r2, userId: nurR2.id } });
    expect((await zeile(c)).accessRootId).toBe(r2);

    const a2 = await neueSeite(ADMIN, () =>
      duplicatePageAction(formular({ pageId: a, withChildren: "1" })),
    );
    const r1k = await kindMitTitel(a2, "Wurzel eins");
    const bk = await kindMitTitel(r1k, "Mitte");
    const r2k = await kindMitTitel(bk, "Wurzel zwei");
    const ck = await kindMitTitel(r2k, "Blatt");

    expect(await zeile(a2)).toMatchObject({ isRestricted: false, accessRootId: null });
    expect(await zeile(r1k)).toMatchObject({ isRestricted: true, accessRootId: r1k });
    expect(await zeile(bk)).toMatchObject({ isRestricted: false, accessRootId: r1k });
    expect(await zeile(r2k)).toMatchObject({ isRestricted: true, accessRootId: r2k });
    expect(await zeile(ck)).toMatchObject({ isRestricted: false, accessRootId: r2k });
    expect(await grants(r1k)).toEqual(await grants(r1));
    expect(await grants(r2k)).toEqual(await grants(r2));
    expect(await grants(a2)).toEqual([]);
    expect(await grants(bk)).toEqual([]);

    // Die innere Wurzel sieht nur, wer sie auch im Original sah.
    expect(await sieht(MEMBER, r1k)).toBe(false);
    expect(await sieht(MEMBER_FREIGABE, bk)).toBe(true);
    expect(await sieht(MEMBER_FREIGABE, ck)).toBe(false);
    expect(await sieht(nurR2, ck)).toBe(true);

    expect((await carried(r1k))[0]?.metadata).toMatchObject({ fromRootId: r1 });
    expect((await carried(r2k))[0]?.metadata).toMatchObject({ fromRootId: r2 });
    expect(await carried(a2)).toEqual([]);
  });

  it("die Kopie einer offenen Seite unter geschützter Elternseite hängt unter derselben Wurzel, ohne eigene Freigaben", async () => {
    const { MEMBER, MEMBER_FREIGABE } = w.personen;
    const r = await seite("Verträge");
    const c = await seite("Vertrag A", { parentId: r });
    await w.schuetze(r);

    const kopie = await neueSeite(MEMBER_FREIGABE, () =>
      duplicatePageAction(formular({ pageId: c })),
    );

    expect(await zeile(kopie)).toMatchObject({
      parentId: r,
      isRestricted: false,
      accessRootId: r,
    });
    expect(await grants(kopie)).toEqual([]);
    expect(await sieht(MEMBER, kopie)).toBe(false);
    expect(await carried(kopie)).toEqual([]);
  });

  it("die Kopie einer offenen Seite bleibt offen, ohne Audit", async () => {
    const { MEMBER } = w.personen;
    const p = await seite("Speiseplan");

    const kopie = await neueSeite(MEMBER, () =>
      duplicatePageAction(formular({ pageId: p })),
    );

    expect(await zeile(kopie)).toMatchObject({
      isRestricted: false,
      accessRootId: null,
    });
    expect(await grants(kopie)).toEqual([]);
    expect(await carried(kopie)).toEqual([]);
  });
});

describe("Seite aus Vorlage", () => {
  it("eine Seite aus einer geschützten Vorlage übernimmt deren Schutz", async () => {
    const { MEMBER, MEMBER_FREIGABE } = w.personen;
    const t = await seite("Kündigung Vorlage", { isTemplate: true });
    await w.schuetze(t);

    const neu = await neueSeite(MEMBER_FREIGABE, () =>
      createFromTemplateAction(formular({ templateId: t })),
    );

    expect(await zeile(neu)).toMatchObject({
      title: "Kündigung Vorlage",
      isRestricted: true,
      accessRootId: neu,
    });
    expect(await grants(neu)).toEqual(await grants(t));
    expect(await sieht(MEMBER, neu)).toBe(false);
    expect(await sieht(MEMBER_FREIGABE, neu)).toBe(true);
    expect((await carried(neu))[0]).toMatchObject({
      actorId: MEMBER_FREIGABE.id,
      metadata: { via: "template", fromRootId: t, sourcePageId: t, grants: 3 },
    });
  });

  it("unter einer geschützten Elternseite wird sie eigene Wurzel mit den Freigaben der Vorlage", async () => {
    const { ADMIN, MEMBER_FREIGABE, OWNER } = w.personen;
    const t = await seite("Vorlage Gehalt", { isTemplate: true });
    await w.schuetze(t);
    const r = await seite("Nur Verwaltung");
    await setPageRestricted(r, true, OWNER.id);

    const neu = await neueSeite(ADMIN, () =>
      createFromTemplateAction(formular({ templateId: t, parentId: r })),
    );

    expect(await zeile(neu)).toMatchObject({
      parentId: r,
      isRestricted: true,
      accessRootId: neu,
    });
    expect(await grants(neu)).toEqual(await grants(t));
    expect(await sieht(MEMBER_FREIGABE, neu)).toBe(true);
  });

  it("eine Seite aus einer offenen Vorlage bleibt offen, ohne Audit", async () => {
    const t = await seite("Protokoll", { isTemplate: true });
    const neu = await neueSeite(w.personen.MEMBER, () =>
      createFromTemplateAction(formular({ templateId: t })),
    );
    expect(await zeile(neu)).toMatchObject({ isRestricted: false, accessRootId: null });
    expect(await carried(neu)).toEqual([]);
  });

  it("createPageAction übernimmt keine Vorlage: die neue Seite ist leer", async () => {
    const t = await seite("Geheime Vorlage", {
      isTemplate: true,
      text: "vertraulicher Text",
    });
    await w.schuetze(t);

    const neu = await neueSeite(w.personen.ADMIN, () =>
      createPageAction(formular({ templateId: t })),
    );

    const n = await zeile(neu);
    expect(n.title).not.toBe("Geheime Vorlage");
    expect(n.textContent).not.toContain("vertraulich");
  });
});
