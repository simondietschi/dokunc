import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Laengen in Codepoints, an jedem Eingang gleich (lib/text-length).
 *
 * Seit zod 4.5 zaehlen die Schemas Codepoints, die handgeschriebenen
 * Pruefungen zaehlten `String.length`, also UTF-16-Einheiten. Bei Emoji
 * lief das auseinander: ein Space mit einem einzelnen Emoji als Namen
 * liess sich anlegen, aber in den Einstellungen nicht speichern; das
 * Profil nahm einen Namen aus einem Emoji an, den die Registrierung
 * ablehnte. Gekappt wurde mit `slice()`, das ein Emoji an der Grenze
 * zerschnitt; in der Datenbank stand dann das Ersatzzeichen U+FFFD.
 *
 * Geprueft wird jeweils die echte Action gegen die echte Datenbank, und
 * wo zwei Eingaenge dieselbe Regel haben, beide mit denselben Werten.
 * Ersetzt sind wie in refusals.test.ts nur Anmeldung, Sitzung,
 * Anfrage-Header, Cache und die Umleitung, dazu die Bremse der
 * Registrierung (sonst zaehlte jeder Lauf im gemeinsamen Redis mit).
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
  requireAdmin: vi.fn(async () => mocks.actor),
  requireUser: vi.fn(async () => mocks.actor),
}));
vi.mock("@/lib/session", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  getSessionClaims: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => true),
  resetLimit: vi.fn(),
  clientKey: vi.fn(async (prefix: string) => `${prefix}:laengen-test`),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));

const { createSpaceAction } = await import("@/app/spaces/actions");
const { updateSpaceAction } = await import("@/app/s/[slug]/settings/actions");
const { updateProfileAction } = await import("@/app/account/actions");
const { registerAction } = await import("@/app/(auth)/actions");
const { createGroupAction, renameGroupAction } = await import(
  "@/app/admin/groups/actions"
);
const { createThreadAction } = await import(
  "@/app/s/[slug]/p/[pageId]/comments/actions"
);
const { renamePageAction } = await import("@/app/s/[slug]/actions");
const { MAX_COMMENT_LENGTH } = await import("@/lib/comment-limits");

const TAG = `len-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const RAKETE = "\u{1F680}";
const LACHEN = "\u{1F600}";

let actor: Actor;
let spaceId: string;
let pageId: string;
/** Spaces, die createSpaceAction in diesen Tests angelegt hat. */
const angelegt: string[] = [];

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
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  const created = await prisma.user.create({
    data: { email: `${TAG}-owner@example.test`, name: "Owner", passwordHash: "x" },
    select: { id: true, email: true, name: true },
  });
  // Gruppen verlangen einen Admin; requireAdmin ist ersetzt, in der
  // Datenbank bleibt das Konto ohne Admin-Recht (der instanzweite Zaehler
  // aktiver Admins gehoert anderen Tests).
  actor = { ...created, isAdmin: true };
  const space = await prisma.space.create({
    data: {
      name: TAG,
      slug: TAG,
      members: { create: { userId: actor.id, role: "OWNER" } },
    },
    select: { id: true },
  });
  spaceId = space.id;
  pageId = (
    await prisma.page.create({
      data: { spaceId, title: `${TAG}-seite`, position: 0 },
      select: { id: true },
    })
  ).id;
  mocks.actor = actor;
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: { in: [spaceId, ...angelegt] } } });
  await prisma.group.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("Space-Name: Anlage und Einstellungen zaehlen gleich", () => {
  const faelle: [string, string, boolean][] = [
    ["ein Emoji", RAKETE, false],
    ["zwei Emoji", RAKETE.repeat(2), true],
    ["80 Emoji (160 Einheiten)", RAKETE.repeat(80), true],
    ["81 Emoji", RAKETE.repeat(81), false],
  ];

  it.each(faelle)("%s", async (_, name, gueltig) => {
    const ziel = await umleitung(createSpaceAction(formular({ name })));
    const space = await prisma.space.findFirst({
      where: { name, members: { some: { userId: actor.id } } },
      select: { id: true, slug: true },
    });
    if (space) angelegt.push(space.id);
    expect(space !== null, "angelegt").toBe(gueltig);
    expect(ziel).toBe(gueltig ? `/s/${space!.slug}` : null);

    const gespeichert = await updateSpaceAction(
      undefined,
      formular({ slug: TAG, name, description: "", icon: "" }),
    );
    expect(gespeichert, "gespeichert").toEqual(
      gueltig
        ? { success: "Einstellungen gespeichert." }
        : { error: expect.stringMatching(/^Name (muss|darf)/) },
    );
  });
});

describe("Personenname: Registrierung und Profil zaehlen gleich", () => {
  const faelle: [string, string, string | null][] = [
    ["ein Emoji", LACHEN, "Name zu kurz"],
    ["zwei Emoji", LACHEN.repeat(2), null],
    ["80 Emoji (160 Einheiten)", LACHEN.repeat(80), null],
    ["81 Emoji", LACHEN.repeat(81), "Name darf höchstens 80 Zeichen haben"],
    ["81 Buchstaben", "x".repeat(81), "Name darf höchstens 80 Zeichen haben"],
  ];

  it.each(faelle)("%s", async (_, name, fehler) => {
    const profil = await updateProfileAction(undefined, formular({ name }));
    expect(profil, "Profil").toEqual(
      fehler ? { error: fehler } : { success: "Profil aktualisiert." },
    );
    const danach = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { name: true },
    });
    if (!fehler) expect(danach.name).toBe(name);
    else expect(danach.name).not.toBe(name);

    // Ohne Einladung endet eine gueltige Registrierung bei der Einladung,
    // nicht beim Namen; angelegt wird dabei kein Konto.
    const registrierung = await registerAction(
      undefined,
      formular({
        name,
        email: `${TAG}-neu@example.test`,
        password: "richtig-und-lang-genug",
      }),
    );
    expect(registrierung?.error, "Registrierung").toEqual(
      fehler ?? expect.stringMatching(/^Registrierung ist nur über/),
    );
    expect(
      await prisma.user.count({ where: { email: `${TAG}-neu@example.test` } }),
    ).toBe(0);
  });
});

describe("Gruppen: Mindestlaenge und Kappen in Codepoints", () => {
  it("lehnt einen Namen aus einem Emoji ab, beim Anlegen und Umbenennen", async () => {
    expect(await createGroupAction(undefined, formular({ name: RAKETE }))).toEqual({
      error: "Name zu kurz.",
    });
    const gruppe = await prisma.group.create({
      data: { name: `${TAG}-gruppe` },
      select: { id: true },
    });
    expect(
      await umleitung(
        renameGroupAction(formular({ groupId: gruppe.id, name: RAKETE })),
      ),
    ).toBe("/admin/groups?nicht-umbenannt=zu-kurz");
  });

  it("kappt Name und Beschreibung, ohne ein Emoji zu zerschneiden", async () => {
    // 60 Zeichen Name: TAG, Fuellung, am Ende das Emoji; dahinter Ueberhang.
    const kopf = `${TAG}${"n".repeat(59 - TAG.length)}`;
    const beschreibung = `${"b".repeat(199)}${RAKETE}`;
    const ergebnis = await createGroupAction(
      undefined,
      formular({ name: `${kopf}${RAKETE}rest`, description: `${beschreibung}rest` }),
    );
    expect(ergebnis).toEqual({ success: `Gruppe „${kopf}${RAKETE}" angelegt.` });
    const gruppe = await prisma.group.findUniqueOrThrow({
      where: { name: `${kopf}${RAKETE}` },
      select: { id: true, description: true },
    });
    expect(gruppe.description).toBe(beschreibung);

    const neu = `${TAG}${"u".repeat(59 - TAG.length)}`;
    expect(
      await umleitung(
        renameGroupAction(
          formular({ groupId: gruppe.id, name: `${neu}${RAKETE}rest` }),
        ),
      ),
    ).toBe("/admin/groups");
    const umbenannt = await prisma.group.findUniqueOrThrow({
      where: { id: gruppe.id },
      select: { name: true },
    });
    expect(umbenannt.name).toBe(`${neu}${RAKETE}`);
  });
});

describe("Kommentare: Grenze und Ankertext in Codepoints", () => {
  it("nimmt 10.000 Emoji an und lehnt 10.001 ab", async () => {
    const passt = randomUUID();
    await createThreadAction(
      formular({
        slug: TAG,
        pageId,
        threadId: passt,
        body: RAKETE.repeat(MAX_COMMENT_LENGTH),
      }),
    );
    expect(await prisma.comment.count({ where: { id: passt } })).toBe(1);

    const zuLang = randomUUID();
    await createThreadAction(
      formular({
        slug: TAG,
        pageId,
        threadId: zuLang,
        body: RAKETE.repeat(MAX_COMMENT_LENGTH + 1),
      }),
    );
    expect(await prisma.comment.count({ where: { id: zuLang } })).toBe(0);
  });

  it("kappt den Ankertext, ohne ein Emoji zu zerschneiden", async () => {
    const threadId = randomUUID();
    await createThreadAction(
      formular({
        slug: TAG,
        pageId,
        threadId,
        body: "Hallo",
        anchorText: `${"a".repeat(299)}${RAKETE}rest`,
      }),
    );
    const kommentar = await prisma.comment.findUniqueOrThrow({
      where: { id: threadId },
      select: { anchorText: true },
    });
    expect(kommentar.anchorText).toBe(`${"a".repeat(299)}${RAKETE}`);
  });
});

describe("Seitentitel: Kappen in Codepoints", () => {
  it("zerschneidet kein Emoji an der Grenze", async () => {
    await renamePageAction(
      formular({ slug: TAG, pageId, title: `${"t".repeat(199)}${RAKETE}rest` }),
    );
    const seite = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { title: true },
    });
    expect(seite.title).toBe(`${"t".repeat(199)}${RAKETE}`);
  });
});
