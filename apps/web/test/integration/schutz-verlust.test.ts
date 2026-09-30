import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { prisma } from "@dokunc/db";
import { PAGE_ACCESS_CHANNEL } from "@dokunc/editor";

/**
 * Seitenschutz auf den Wegen, die eine Seite neu entstehen lassen oder
 * umhängen: Kopie, Seite aus Vorlage, Vorlage aus geschützter Seite,
 * Verschieben, Wiederherstellen und endgültiges Löschen.
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
const { createPageAction, purgePageAction, restorePageAction } = await import(
  "@/app/s/[slug]/actions"
);
const { movePageAction } = await import("@/app/s/[slug]/move-actions");
const { createFromTemplateAction, duplicatePageAction, saveAsTemplateAction } =
  await import("@/app/s/[slug]/template-actions");
const { BestaetigungNoetig, schutzwechselToken } = await import(
  "@/lib/confirmation"
);
const { readablePageRole, refreshAccessRoots, setPageRestricted } = await import(
  "@/lib/page-access"
);
const { trashPageTree } = await import("@/lib/page-guards");

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
  // Wie jede Anlage in der App: unter einer geschützten Seite geschützt.
  if (o.parentId) await refreshAccessRoots(p.id);
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

describe("Vorlage aus geschützter Seite", () => {
  async function vorlagen(text: string) {
    return prisma.page.findMany({
      where: { spaceId: w.space.id, isTemplate: true, textContent: text },
      select: { id: true, isRestricted: true, accessRootId: true },
    });
  }
  async function changed(targetId: string) {
    return prisma.auditLog.findMany({
      where: { action: "page.protection_changed", targetId },
      select: { actorId: true, metadata: true },
    });
  }

  it("die Verwaltung bekommt ohne passendes Token eine Rückfrage, und es entsteht nichts", async () => {
    const p = await seite("Abmahnung", { text: "abmahnung-inhalt" });
    await w.schuetze(p);
    const andere = await seite("Andere Wurzel");

    for (const token of [undefined, schutzwechselToken(andere, null)]) {
      const fehler = await w
        .alsPerson(w.personen.ADMIN, () =>
          saveAsTemplateAction(
            formular({ pageId: p, ...(token ? { confirmProtection: token } : {}) }),
          ),
        )
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(fehler).toBeInstanceOf(BestaetigungNoetig);
      expect((fehler as InstanceType<typeof BestaetigungNoetig>).token).toBe(
        schutzwechselToken(p, null),
      );
    }
    expect(await vorlagen("abmahnung-inhalt")).toEqual([]);
  });

  it("mit dem Token der Rückfrage entsteht eine offene Vorlage, und das Audit hält es fest", async () => {
    const { ADMIN } = w.personen;
    const r = await seite("Personal", { text: "personal-inhalt" });
    const c = await seite("Zeugnis", { parentId: r, text: "zeugnis-inhalt" });
    await w.schuetze(r);

    const vorlage = await neueSeite(ADMIN, () =>
      saveAsTemplateAction(
        formular({ pageId: c, confirmProtection: schutzwechselToken(r, null) }),
      ),
    );

    expect(await vorlagen("zeugnis-inhalt")).toEqual([
      { id: vorlage, isRestricted: false, accessRootId: null },
    ]);
    expect(await changed(vorlage)).toEqual([
      {
        actorId: ADMIN.id,
        metadata: {
          via: "template",
          sourcePageId: c,
          fromRootId: r,
          toRootId: null,
          confirmed: true,
          title: "Zeugnis",
        },
      },
    ]);
  });

  it("MEMBER mit Freigabe darf eine geschützte Seite nicht als Vorlage speichern, auch nicht mit richtigem Token", async () => {
    const p = await seite("Gehälter", { text: "gehaelter-inhalt" });
    await w.schuetze(p);

    await expect(
      w.alsPerson(w.personen.MEMBER_FREIGABE, () =>
        saveAsTemplateAction(
          formular({ pageId: p, confirmProtection: schutzwechselToken(p, null) }),
        ),
      ),
    ).rejects.toThrow(
      "Geschützte Seiten kann nur die Space-Verwaltung als Vorlage speichern.",
    );
    expect(await vorlagen("gehaelter-inhalt")).toEqual([]);
  });

  it("eine offene Seite wird ohne Rückfrage und ohne Audit zur Vorlage", async () => {
    const p = await seite("Checkliste", { text: "checkliste-inhalt" });
    const vorlage = await neueSeite(w.personen.MEMBER, () =>
      saveAsTemplateAction(formular({ pageId: p })),
    );
    expect(await vorlagen("checkliste-inhalt")).toHaveLength(1);
    expect(await changed(vorlage)).toEqual([]);
  });
});

describe("Zug", () => {
  /**
   * Nachrichten an den Collab-Server mitlesen. Pub/Sub gilt über alle
   * Redis-Datenbanken und alle Tests hinweg: gezählt wird nur, was eine
   * Seite dieses Falls nennt.
   */
  let abo: Redis;
  const nachrichten: string[] = [];
  beforeAll(async () => {
    abo = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
    });
    await abo.subscribe(PAGE_ACCESS_CHANNEL);
    abo.on("message", (_kanal, text: string) => {
      nachrichten.push((JSON.parse(text) as { pageId: string }).pageId);
    });
  });
  afterAll(async () => {
    await abo.quit();
  });
  /** Wartet, bis eine Nachricht zu `pageId` ankam (höchstens 3 s). */
  async function nachrichtZu(pageId: string): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
      if (nachrichten.includes(pageId)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  function zug(
    p: Person,
    felder: { pageId: string; parentId: string | null; token?: string },
  ) {
    return w.alsPerson(p, () =>
      movePageAction(
        formular({
          pageId: felder.pageId,
          parentId: felder.parentId ?? "",
          ...(felder.token ? { confirmProtection: felder.token } : {}),
        }),
      ),
    );
  }
  async function changed(targetId: string) {
    return prisma.auditLog.findMany({
      where: { action: "page.protection_changed", targetId },
      select: { actorId: true, metadata: true },
    });
  }
  async function geschuetzterAst() {
    const r = await seite("Personal");
    const c = await seite("Beurteilung", { parentId: r });
    await w.schuetze(r);
    return { r, c };
  }

  it("die Verwaltung bekommt eine Rückfrage; ein veraltetes Token schaltet nichts frei", async () => {
    const { r, c } = await geschuetzterAst();
    const r2 = await seite("Andere Wurzel");
    await w.schuetze(r2);

    const erst = await zug(w.personen.ADMIN, { pageId: c, parentId: null });
    expect(erst).toEqual({
      ok: false,
      error:
        "„Beurteilung“ ist über „Personal“ geschützt. An der neuen Stelle " +
        "ist sie samt Unterseiten für alle im Space sichtbar.",
      confirm: schutzwechselToken(r, null),
    });
    // Das Token für den Zug an die oberste Ebene bestätigt keinen anderen.
    const anders = await zug(w.personen.ADMIN, {
      pageId: c,
      parentId: r2,
      token: schutzwechselToken(r, null),
    });
    expect(anders).toMatchObject({
      ok: false,
      confirm: schutzwechselToken(r, r2),
      error:
        "„Beurteilung“ ist über „Personal“ geschützt. An der neuen Stelle " +
        "gelten stattdessen die Freigaben von „Andere Wurzel“.",
    });
    expect(await zeile(c)).toMatchObject({ parentId: r, accessRootId: r });
    expect(await changed(c)).toEqual([]);
  });

  it("MEMBER mit Freigabe darf nicht aus dem Schutz ziehen, auch nicht mit richtigem Token", async () => {
    const { r, c } = await geschuetzterAst();
    const ergebnis = await zug(w.personen.MEMBER_FREIGABE, {
      pageId: c,
      parentId: null,
      token: schutzwechselToken(r, null),
    });
    expect(ergebnis).toEqual({
      ok: false,
      error:
        "Diese Seite ist geschützt. Verschieben würde ändern, wer sie sehen " +
        "darf – das kann nur die Space-Verwaltung.",
    });
    expect(await zeile(c)).toMatchObject({ parentId: r, accessRootId: r });
  });

  it("bestätigt aus dem Schutz an die oberste Ebene: offen und im Audit", async () => {
    const { r, c } = await geschuetzterAst();
    expect(
      await zug(w.personen.OWNER, {
        pageId: c,
        parentId: null,
        token: schutzwechselToken(r, null),
      }),
    ).toEqual({ ok: true });
    expect(await zeile(c)).toMatchObject({ parentId: null, accessRootId: null });
    expect(await changed(c)).toEqual([
      {
        actorId: w.personen.OWNER.id,
        metadata: {
          via: "move",
          fromRootId: r,
          toRootId: null,
          confirmed: true,
          title: "Beurteilung",
          sharesRevoked: 0,
        },
      },
    ]);
  });

  it("bestätigt von einer Wurzel unter eine andere: neue Wurzel, Audit, Nachricht an den Collab-Server", async () => {
    const { r, c } = await geschuetzterAst();
    const r2 = await seite("Verträge");
    await w.schuetze(r2);
    expect(
      await zug(w.personen.ADMIN, {
        pageId: c,
        parentId: r2,
        token: schutzwechselToken(r, r2),
      }),
    ).toEqual({ ok: true });
    expect(await zeile(c)).toMatchObject({ parentId: r2, accessRootId: r2 });
    expect((await changed(c))[0]?.metadata).toMatchObject({
      fromRootId: r,
      toRootId: r2,
      confirmed: true,
    });
    expect(await nachrichtZu(r2)).toBe(true);
  });

  it("offen in einen geschützten Ast darf auch MEMBER mit Freigabe, ohne Rückfrage; ME sieht die Seite danach nicht", async () => {
    const { MEMBER, MEMBER_FREIGABE } = w.personen;
    const x = await seite("Notizen");
    const kind = await seite("Notizen Teil 2", { parentId: x });
    const r = await seite("Geheim");
    await w.schuetze(r);

    expect(await zug(MEMBER_FREIGABE, { pageId: x, parentId: r })).toEqual({
      ok: true,
    });
    expect(await zeile(x)).toMatchObject({ parentId: r, accessRootId: r });
    expect(await zeile(kind)).toMatchObject({ accessRootId: r });
    expect(await sieht(MEMBER, x)).toBe(false);
    expect(await sieht(MEMBER, kind)).toBe(false);
    expect(await changed(x)).toEqual([
      {
        actorId: MEMBER_FREIGABE.id,
        metadata: {
          via: "move",
          fromRootId: null,
          toRootId: r,
          confirmed: false,
          title: "Notizen",
          sharesRevoked: 0,
        },
      },
    ]);
    // Offene Editoren des Astes sofort prüfen lassen, nicht erst in der
    // wiederkehrenden Runde des Collab-Servers.
    expect(await nachrichtZu(r)).toBe(true);
  });

  it("ein Zug ohne Wechsel der Wurzel schreibt kein Audit und schickt keine Nachricht", async () => {
    const { r, c } = await geschuetzterAst();
    const nachbar = await seite("Nachbar", { parentId: r });
    const anfang = nachrichten.length;

    expect(
      await zug(w.personen.MEMBER_FREIGABE, { pageId: c, parentId: nachbar }),
    ).toEqual({ ok: true });
    // Kontrollzug mit Wechsel: dessen Nachricht muss ankommen; kommt sie,
    // wäre eine Nachricht zum ersten Zug schon vorher da gewesen.
    const x = await seite("Kontrolle");
    const r2 = await seite("Kontrollwurzel");
    await w.schuetze(r2);
    await zug(w.personen.MEMBER_FREIGABE, { pageId: x, parentId: r2 });
    expect(await nachrichtZu(r2)).toBe(true);

    expect(await zeile(c)).toMatchObject({ parentId: nachbar, accessRootId: r });
    expect(await changed(c)).toEqual([]);
    expect(nachrichten.slice(anfang)).not.toContain(r);
  });

  it("Freigabelinks im verschobenen Ast werden beim Wechsel der Wurzel zurückgezogen", async () => {
    const { r, c } = await geschuetzterAst();
    const unter = await seite("Anhang", { parentId: c });
    const link = await prisma.pageShare.create({
      data: { pageId: unter, tokenHash: `hash-${unter}` },
      select: { id: true },
    });
    const offen = await seite("Offen");
    const offenerLink = await prisma.pageShare.create({
      data: { pageId: offen, tokenHash: `hash-${offen}` },
      select: { id: true },
    });

    await zug(w.personen.ADMIN, {
      pageId: c,
      parentId: null,
      token: schutzwechselToken(r, null),
    });
    const [zurueck, bleibt] = await Promise.all([
      prisma.pageShare.findUniqueOrThrow({ where: { id: link.id } }),
      prisma.pageShare.findUniqueOrThrow({ where: { id: offenerLink.id } }),
    ]);
    // Sonst läge der Ast mit dem Zug wieder öffentlich im Netz.
    expect(zurueck.revokedAt).not.toBeNull();
    expect(bleibt.revokedAt).toBeNull();
    expect((await changed(c))[0]?.metadata).toMatchObject({ sharesRevoked: 1 });
  });
});

describe("Papierkorb", () => {
  async function geschuetzterAst() {
    const r = await seite("Personalakten");
    const k = await seite("Akte Muster", { parentId: r });
    await w.schuetze(r);
    return { r, k };
  }
  function als(p: Person, lauf: () => Promise<unknown>) {
    return w.alsPerson(p, lauf);
  }

  it.each(["MEMBER_FREIGABE", "ADMIN"] as const)(
    "eine Unterseite, deren geschützte Elternseite im Papierkorb bleibt, kommt geschützt zurück (%s)",
    async (akteur) => {
      const { MEMBER, MEMBER_FREIGABE } = w.personen;
      const { r, k } = await geschuetzterAst();
      await trashPageTree(w.space.id, r);

      await als(w.personen[akteur], () =>
        restorePageAction(formular({ pageId: k })),
      );

      expect(await zeile(k)).toMatchObject({
        parentId: null,
        isRestricted: true,
        accessRootId: k,
      });
      expect(await grants(k)).toEqual(await grants(r));
      expect(await sieht(MEMBER, k)).toBe(false);
      expect(await sieht(MEMBER_FREIGABE, k)).toBe(true);
      expect((await carried(k))[0]).toMatchObject({
        actorId: w.personen[akteur].id,
        metadata: { via: "restore", fromRootId: r, grants: 3 },
      });
    },
  );

  it("eine selbst geschützte Seite kommt ohne Übernahme zurück", async () => {
    const p = await seite("Eigene Wurzel");
    await w.schuetze(p);
    const vorher = await grants(p);
    await trashPageTree(w.space.id, p);

    await als(w.personen.ADMIN, () => restorePageAction(formular({ pageId: p })));

    expect(await zeile(p)).toMatchObject({ isRestricted: true, accessRootId: p });
    expect(await grants(p)).toEqual(vorher);
    expect(await carried(p)).toEqual([]);
  });

  it("endgültiges Löschen einer geschützten Wurzel: das lebende Kind behält deren Schutz", async () => {
    const { MEMBER, MEMBER_FREIGABE, ADMIN } = w.personen;
    const { r, k } = await geschuetzterAst();
    const enkel = await seite("Anlage", { parentId: k });
    await trashPageTree(w.space.id, r);
    // Das Kind wieder ins Leben holen, ohne die Elternseite.
    await prisma.page.updateMany({
      where: { id: { in: [k, enkel] } },
      data: { deletedAt: null },
    });
    const grantsVorher = await grants(r);

    await als(ADMIN, () => purgePageAction(formular({ pageId: r })));

    expect(await prisma.page.count({ where: { id: r } })).toBe(0);
    expect(await zeile(k)).toMatchObject({
      parentId: null,
      isRestricted: true,
      accessRootId: k,
    });
    expect(await zeile(enkel)).toMatchObject({ accessRootId: k });
    expect(await grants(k)).toEqual(grantsVorher);
    expect(await sieht(MEMBER, enkel)).toBe(false);
    expect(await sieht(MEMBER_FREIGABE, enkel)).toBe(true);
    expect((await carried(k))[0]).toMatchObject({
      actorId: ADMIN.id,
      metadata: { via: "purge", fromRootId: r, grants: 3 },
    });
  });

  it("endgültiges Löschen einer Zwischenseite: das lebende Kind übernimmt die Freigaben der lebenden Wurzel", async () => {
    const { MEMBER, OWNER } = w.personen;
    const { r, k: x } = await geschuetzterAst();
    const l = await seite("Lebend", { parentId: x });
    await prisma.page.update({ where: { id: x }, data: { deletedAt: new Date() } });

    await als(OWNER, () => purgePageAction(formular({ pageId: x })));

    expect(await zeile(l)).toMatchObject({
      parentId: null,
      isRestricted: true,
      accessRootId: l,
    });
    expect(await grants(l)).toEqual(await grants(r));
    expect(await sieht(MEMBER, l)).toBe(false);
    expect((await carried(l))[0]?.metadata).toMatchObject({
      via: "purge",
      fromRootId: r,
    });
  });

  it("endgültig löschen darf nur die Space-Verwaltung, und page.purged bleibt im Audit", async () => {
    const p = await seite("Altes Protokoll");
    await trashPageTree(w.space.id, p);

    for (const akteur of ["MEMBER", "MEMBER_FREIGABE"] as const) {
      await expect(
        als(w.personen[akteur], () => purgePageAction(formular({ pageId: p }))),
      ).rejects.toThrow("Kein Zugriff auf diese Aktion");
    }
    expect(await prisma.page.count({ where: { id: p } })).toBe(1);

    await als(w.personen.ADMIN, () => purgePageAction(formular({ pageId: p })));
    expect(await prisma.page.count({ where: { id: p } })).toBe(0);
    expect(
      await prisma.auditLog.findMany({
        where: { action: "page.purged", targetId: p },
        select: { actorId: true, metadata: true },
      }),
    ).toEqual([
      { actorId: w.personen.ADMIN.id, metadata: { title: "Altes Protokoll" } },
    ]);
  });

  it("ein offenes lebendes Kind bleibt beim endgültigen Löschen offen, ohne Audit", async () => {
    const p = await seite("Offen im Papierkorb");
    const kind = await seite("Offenes Kind", { parentId: p });
    await prisma.page.update({ where: { id: p }, data: { deletedAt: new Date() } });

    await als(w.personen.ADMIN, () => purgePageAction(formular({ pageId: p })));

    expect(await zeile(kind)).toMatchObject({
      parentId: null,
      isRestricted: false,
      accessRootId: null,
    });
    expect(await carried(kind)).toEqual([]);
  });
});
