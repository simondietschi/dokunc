import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Ablehnungen im Admin-Bereich: sichtbar statt wortlos.
 *
 * toggleUserActiveAction und renameGroupAction brachen bei einer
 * Ablehnung ohne Meldung und ohne Log ab. Jetzt schreiben sie einen
 * Log-Eintrag und leiten mit einer Kennung um, die die Seite in bekannten
 * Text uebersetzt — dasselbe Muster wie deleteUserAction. Dazu die
 * Loesch-Actions, deren Pruefung jetzt in einer Transaktion steht: die
 * Ablehnung muss dort genauso ankommen wie vorher.
 *
 * Geprueft wird die echte Action gegen die echte Datenbank. Ersetzt sind
 * nur die Stellen, die ausserhalb einer Next-Anfrage nicht laufen:
 * Anmeldung, Sitzungs-Cookie, Anfrage-Header, Cache und die Umleitung
 * (die hier als Fehler mit der Zieladresse ankommt).
 *
 * "Letzter aktiver Admin" pruefen die Gleichzeitigkeitstests am Ende.
 * Der Zaehler gilt instanzweit; sie sperren deshalb fuer ihre Dauer jedes
 * andere aktive Admin-Konto und schalten es danach wieder frei.
 *
 * Ein Erfolg leitet auf die Seite OHNE Kennung zurueck. Mit blossem
 * revalidatePath blieb eine Ablehnung von vorhin in der Adresszeile
 * stehen, und die Seite meldete nach einer gelungenen Aenderung weiter
 * "Nichts geändert".
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Fuer die Client-IP im Audit-Eintrag. Ohne Anfrage wirft das echte
// headers(), und audit() schriebe statt des Eintrags eine Fehlermeldung.
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));

const { log } = await import("@/lib/log");
const warn = vi.spyOn(log, "warn");
const { requireAdmin, requireUser } = await import("@/lib/current-user");
const { toggleUserActiveAction, toggleUserAdminAction, deleteUserAction } =
  await import("@/app/admin/actions");
const { renameGroupAction } = await import("@/app/admin/groups/actions");
const { deleteAccountAction } = await import("@/app/account/actions");
const { leaveSpaceAction } = await import("@/app/s/[slug]/settings/actions");
const bcrypt = (await import("bcryptjs")).default;

const TAG = `refuse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORT = "richtig-und-lang-genug";

let admin: Actor;
let plain: { id: string };
let soleOwner: { id: string };
let spaceId: string;
let groupA: { id: string; name: string };
let groupB: { id: string; name: string };

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
  // In der Datenbank KEIN Admin: requireAdmin ist ersetzt, und ein
  // weiteres aktives Admin-Konto veraenderte den instanzweiten Zaehler,
  // auf den sich andere Laeufe verlassen.
  const created = await prisma.user.create({
    data: {
      email: `${TAG}-admin@example.test`,
      name: "Verwaltung",
      passwordHash: "x",
    },
    select: { id: true, email: true, name: true },
  });
  admin = { ...created, isAdmin: true };
  plain = await prisma.user.create({
    data: { email: `${TAG}-plain@example.test`, name: "Plain", passwordHash: "x" },
    select: { id: true },
  });
  soleOwner = await prisma.user.create({
    data: {
      email: `${TAG}-owner@example.test`,
      name: "Owner",
      passwordHash: await bcrypt.hash(PASSWORT, 4),
    },
    select: { id: true },
  });
  const space = await prisma.space.create({
    data: {
      name: `${TAG}-space`,
      slug: `${TAG}-space`,
      members: { create: { userId: soleOwner.id, role: "OWNER" } },
    },
    select: { id: true },
  });
  spaceId = space.id;
  groupA = await prisma.group.create({
    data: { name: `${TAG}-a` },
    select: { id: true, name: true },
  });
  groupB = await prisma.group.create({
    data: { name: `${TAG}-b` },
    select: { id: true, name: true },
  });
});

afterAll(async () => {
  await prisma.group.deleteMany({
    where: { id: { in: [groupA.id, groupB.id] } },
  });
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TAG } },
  });
});

beforeEach(() => {
  mocks.actor = admin;
  warn.mockClear();
});

describe("toggleUserActiveAction", () => {
  it("meldet die Selbstsperre, statt wortlos abzubrechen", async () => {
    const ziel = await umleitung(
      toggleUserActiveAction(formular({ userId: admin.id })),
    );
    expect(ziel).toBe("/admin?status-unveraendert=selbst");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "selbst", actorId: admin.id }),
      expect.any(String),
    );
    const danach = await prisma.user.findUnique({
      where: { id: admin.id },
      select: { isActive: true },
    });
    expect(danach?.isActive).toBe(true);
  });

  it("meldet ein unbekanntes Konto", async () => {
    const ziel = await umleitung(
      toggleUserActiveAction(formular({ userId: `${TAG}-gibt-es-nicht` })),
    );
    expect(ziel).toBe("/admin?status-unveraendert=unbekannt");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unbekannt" }),
      expect.any(String),
    );
  });

  it("sperrt ein gewoehnliches Konto und leitet ohne Kennung zurueck", async () => {
    const ziel = await umleitung(
      toggleUserActiveAction(formular({ userId: plain.id })),
    );
    expect(ziel).toBe("/admin");
    const danach = await prisma.user.findUnique({
      where: { id: plain.id },
      select: { isActive: true },
    });
    expect(danach?.isActive).toBe(false);
    // Zuruecksetzen fuer die folgenden Faelle.
    await prisma.user.update({
      where: { id: plain.id },
      data: { isActive: true },
    });
  });
});

describe("toggleUserAdminAction", () => {
  it("meldet ein unbekanntes Konto, statt wortlos abzubrechen", async () => {
    const ziel = await umleitung(
      toggleUserAdminAction(formular({ userId: `${TAG}-gibt-es-nicht` })),
    );
    expect(ziel).toBe("/admin?status-unveraendert=unbekannt");
  });

  it("vergibt und entzieht Adminrechte und leitet ohne Kennung zurueck", async () => {
    const hin = await umleitung(
      toggleUserAdminAction(formular({ userId: plain.id })),
    );
    expect(hin).toBe("/admin");
    try {
      expect(
        (await prisma.user.findUnique({ where: { id: plain.id } }))?.isAdmin,
      ).toBe(true);
    } finally {
      // Sofort zurueck: ein weiteres aktives Admin-Konto veraenderte den
      // instanzweiten Zaehler.
      const zurueck = await umleitung(
        toggleUserAdminAction(formular({ userId: plain.id })),
      );
      expect(zurueck).toBe("/admin");
    }
    expect(
      (await prisma.user.findUnique({ where: { id: plain.id } }))?.isAdmin,
    ).toBe(false);
  });
});

describe("renameGroupAction", () => {
  it("meldet einen zu kurzen Namen", async () => {
    const ziel = await umleitung(
      renameGroupAction(formular({ groupId: groupA.id, name: "x" })),
    );
    expect(ziel).toBe("/admin/groups?nicht-umbenannt=zu-kurz");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "zu-kurz", groupId: groupA.id }),
      expect.any(String),
    );
    const danach = await prisma.group.findUnique({ where: { id: groupA.id } });
    expect(danach?.name).toBe(groupA.name);
  });

  it("meldet einen schon vergebenen Namen", async () => {
    const ziel = await umleitung(
      renameGroupAction(formular({ groupId: groupA.id, name: groupB.name })),
    );
    expect(ziel).toBe("/admin/groups?nicht-umbenannt=vergeben");
    const danach = await prisma.group.findUnique({ where: { id: groupA.id } });
    expect(danach?.name).toBe(groupA.name);
  });

  it("benennt mit freiem Namen um und leitet ohne Kennung zurueck", async () => {
    const neu = `${TAG}-neu`;
    const ziel = await umleitung(
      renameGroupAction(formular({ groupId: groupA.id, name: neu })),
    );
    expect(ziel).toBe("/admin/groups");
    const danach = await prisma.group.findUnique({ where: { id: groupA.id } });
    expect(danach?.name).toBe(neu);
    groupA = { ...groupA, name: neu };
  });
});

describe("Loeschen mit Pruefung in der Transaktion", () => {
  it("deleteUserAction: alleinige Eigentuemerin bleibt, mit Kennung", async () => {
    const ziel = await umleitung(
      deleteUserAction(formular({ userId: soleOwner.id })),
    );
    expect(ziel).toBe("/admin?nicht-geloescht=verwaiste-spaces");
    expect(
      await prisma.user.count({ where: { id: soleOwner.id } }),
    ).toBe(1);
  });

  it("deleteAccountAction: alleinige Eigentuemerin bleibt, mit Meldung", async () => {
    mocks.actor = {
      id: soleOwner.id,
      email: `${TAG}-owner@example.test`,
      name: "Owner",
      isAdmin: false,
    };
    const antwort = await deleteAccountAction(
      undefined,
      formular({ password: PASSWORT }),
    );
    expect(antwort?.error).toContain(`${TAG}-space`);
    expect(
      await prisma.user.count({ where: { id: soleOwner.id } }),
    ).toBe(1);
  });

  it("deleteUserAction: ein gewoehnliches Konto verschwindet", async () => {
    const weg = await prisma.user.create({
      data: { email: `${TAG}-weg@example.test`, name: "Weg", passwordHash: "x" },
      select: { id: true },
    });
    const ziel = await umleitung(deleteUserAction(formular({ userId: weg.id })));
    expect(ziel).toBe("/admin");
    expect(await prisma.user.count({ where: { id: weg.id } })).toBe(0);
  });

  it("deleteAccountAction: das eigene Konto verschwindet", async () => {
    const weg = await prisma.user.create({
      data: {
        email: `${TAG}-selbst@example.test`,
        name: "Selbst",
        passwordHash: await bcrypt.hash(PASSWORT, 4),
      },
      select: { id: true, email: true, name: true, isAdmin: true },
    });
    mocks.actor = weg;
    const ziel = await umleitung(
      deleteAccountAction(undefined, formular({ password: PASSWORT })),
    );
    expect(ziel).toBe("/login");
    expect(await prisma.user.count({ where: { id: weg.id } })).toBe(0);
  });
});

/** Die angemeldete Person, wie requireAdmin und requireUser sie liefern. */
function sitzung(a: Actor) {
  return { ...a, tokenVersion: 0, sessionId: `${TAG}-sitzung` };
}

/** Ergebnis einer Action mit Rueckgabewert: Umleitung oder Antwort. */
async function ausgang<T>(
  run: Promise<T>,
): Promise<{ url: string } | { antwort: T }> {
  try {
    return { antwort: await run };
  } catch (e) {
    if (e instanceof mocks.Umleitung) return { url: e.url };
    throw e;
  }
}

describe("Gleichzeitig", () => {
  let gesperrt: string[] = [];

  beforeAll(async () => {
    // Der Zaehler "aktive Admins" gilt instanzweit. Damit die beiden
    // Konten eines Falls die letzten sind, ruhen alle anderen fuer die
    // Dauer dieses Blocks.
    const andere = await prisma.user.findMany({
      where: { isAdmin: true, isActive: true },
      select: { id: true },
    });
    gesperrt = andere.map((u) => u.id);
    await prisma.user.updateMany({
      where: { id: { in: gesperrt } },
      data: { isActive: false },
    });
  });

  afterAll(async () => {
    await prisma.user.updateMany({
      where: { id: { in: gesperrt } },
      data: { isActive: true },
    });
  });

  /** Zwei aktive Admins, die nach dem Fall wieder verschwinden. */
  async function zweiAdmins(fall: string): Promise<[Actor, Actor]> {
    const [a, b] = await Promise.all(
      ["a", "b"].map((n) =>
        prisma.user.create({
          data: {
            email: `${TAG}-${fall}-${n}@example.test`,
            name: `Admin ${n}`,
            passwordHash: "x",
            isAdmin: true,
          },
          select: { id: true, email: true, name: true, isAdmin: true },
        }),
      ),
    );
    return [a, b];
  }

  /** Der unterlegene Versuch endet sichtbar, nie als Fehlerseite. */
  const SICHTBAR = /^\/admin\?(gleichzeitig-geaendert=1|status-unveraendert=letzter-admin(-rechte)?)$/;

  it("sperren sich die letzten beiden Admins gegenseitig, bleibt einer aktiv", async () => {
    const [a, b] = await zweiAdmins("sperren");
    try {
      vi.mocked(requireAdmin)
        .mockResolvedValueOnce(sitzung(a))
        .mockResolvedValueOnce(sitzung(b));
      const ziele = await Promise.all([
        umleitung(toggleUserActiveAction(formular({ userId: b.id }))),
        umleitung(toggleUserActiveAction(formular({ userId: a.id }))),
      ]);
      expect(
        await prisma.user.count({
          where: { id: { in: [a.id, b.id] }, isActive: true },
        }),
      ).toBe(1);
      expect(ziele).toContain("/admin");
      expect(ziele.filter((z) => z !== "/admin")).toEqual([
        expect.stringMatching(SICHTBAR),
      ]);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
  });

  it("entziehen sich die letzten beiden Admins gegenseitig die Rechte, bleibt einer Admin", async () => {
    const [a, b] = await zweiAdmins("rechte");
    try {
      vi.mocked(requireAdmin)
        .mockResolvedValueOnce(sitzung(a))
        .mockResolvedValueOnce(sitzung(b));
      const ziele = await Promise.all([
        umleitung(toggleUserAdminAction(formular({ userId: b.id }))),
        umleitung(toggleUserAdminAction(formular({ userId: a.id }))),
      ]);
      expect(
        await prisma.user.count({
          where: { id: { in: [a.id, b.id] }, isAdmin: true },
        }),
      ).toBe(1);
      expect(ziele).toContain("/admin");
      expect(ziele.filter((z) => z !== "/admin")).toEqual([
        expect.stringMatching(SICHTBAR),
      ]);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
  });

  it("zwei Umbenennungen auf denselben Namen enden beide sichtbar", async () => {
    // Deterministisch statt auf einen Zufallstreffer gewartet: eine dritte
    // Transaktion sperrt beide Gruppenzeilen. Die Umbenennungen kommen an
    // der Namenspruefung vorbei (der Name ist noch frei) und warten dann
    // am Schreiben. Danach gewinnt eine, die andere laeuft in den
    // Unique-Fehler auf Group.name.
    const [g1, g2] = await Promise.all(
      ["g1", "g2"].map((n) =>
        prisma.group.create({
          data: { name: `${TAG}-${n}` },
          select: { id: true },
        }),
      ),
    );
    const ziel = `${TAG}-ziel`;
    try {
      let laeufe: Promise<(string | null)[]> | undefined;
      await prisma.$transaction(
        async (halter) => {
          await halter.$queryRaw`
            SELECT id FROM "Group" WHERE id IN (${g1.id}, ${g2.id}) FOR UPDATE
          `;
          laeufe = Promise.all([
            umleitung(renameGroupAction(formular({ groupId: g1.id, name: ziel }))),
            umleitung(renameGroupAction(formular({ groupId: g2.id, name: ziel }))),
          ]);
          await new Promise((r) => setTimeout(r, 400));
        },
        { timeout: 15_000 },
      );
      const ziele = await laeufe!;
      expect([...ziele].sort()).toEqual([
        "/admin/groups",
        "/admin/groups?nicht-umbenannt=vergeben",
      ]);
      expect(await prisma.group.count({ where: { name: ziel } })).toBe(1);
    } finally {
      await prisma.group.deleteMany({ where: { id: { in: [g1.id, g2.id] } } });
    }
  });

  it("treten die letzten beiden Owner gleichzeitig aus, bleibt einer", async () => {
    const [o1, o2] = await zweiAdmins("owner");
    const slug = `${TAG}-austritt`;
    await prisma.space.create({
      data: {
        name: slug,
        slug,
        members: {
          create: [
            { userId: o1.id, role: "OWNER" },
            { userId: o2.id, role: "OWNER" },
          ],
        },
      },
    });
    try {
      vi.mocked(requireUser)
        .mockResolvedValueOnce(sitzung(o1))
        .mockResolvedValueOnce(sitzung(o2));
      const ausgaenge = await Promise.all([
        ausgang(leaveSpaceAction(undefined, formular({ slug }))),
        ausgang(leaveSpaceAction(undefined, formular({ slug }))),
      ]);
      expect(
        await prisma.spaceMember.count({
          where: { space: { slug }, role: "OWNER" },
        }),
      ).toBe(1);
      expect(ausgaenge).toContainEqual({ url: "/spaces" });
      // Der zweite Austritt endet als Meldung im Formular: entweder hat
      // er den Konflikt verloren, oder er kam erst danach und sah sich als
      // letzten Owner. Eine Fehlerseite ist keines von beiden.
      expect(ausgaenge.filter((x) => !("url" in x))).toEqual([
        {
          antwort: {
            error: expect.stringMatching(/gleichzeitig geändert|letzte Owner/),
          },
        },
      ]);
    } finally {
      await prisma.space.deleteMany({ where: { slug } });
      await prisma.user.deleteMany({ where: { id: { in: [o1.id, o2.id] } } });
    }
  });
});
