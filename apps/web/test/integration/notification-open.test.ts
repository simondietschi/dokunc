import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Benachrichtigungen oeffnen und als gelesen fuehren.
 *
 * Eine Aenderungsmeldung (PAGE_UPDATED) fuehrt ueber /notifications/<id>
 * auf den Vergleich "Stand vor der Aenderung gegen aktuell" und setzt
 * sich dabei auf gelesen; sonst kaeme zu dieser Seite nie wieder eine.
 * Welche Version der Vergleichsstand ist, haengt an Zeilen in der
 * Datenbank (auch an ausgeduennten), deshalb gegen echtes Postgres.
 * Ersetzt sind nur Anmeldung, Umleitung, Cache und der Live-Kanal.
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
  getCurrentUser: vi.fn(async () => mocks.actor),
  requireUser: vi.fn(async () => {
    if (!mocks.actor) throw new mocks.Umleitung("/login");
    return mocks.actor;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));
vi.mock("@/lib/notify-bus", () => ({ publishNotification: vi.fn() }));

const { GET } = await import("@/app/notifications/[id]/route");
const { markPageUpdatesRead } = await import("@/lib/page-updates");
const { loadNotificationList } = await import("@/lib/notification-list");
const { markAllReadAction } = await import("@/app/notifications/actions");
const { publishNotification } = await import("@/lib/notify-bus");

const TAG = `nopen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let me: Actor;
let other: string;
let spaceId: string;
const slug = TAG;

async function oeffne(id: string): Promise<string> {
  try {
    await GET(new Request(`http://localhost/notifications/${id}`), {
      params: Promise.resolve({ id }),
    });
  } catch (e) {
    if (e instanceof mocks.Umleitung) return e.url;
    throw e;
  }
  throw new Error("Route hat nicht umgeleitet");
}

async function neueSeite(
  data: { isRestricted?: boolean; deletedAt?: Date } = {},
): Promise<string> {
  const page = await prisma.page.create({
    data: { spaceId, title: `${TAG}-seite`, deletedAt: data.deletedAt },
    select: { id: true },
  });
  if (data.isRestricted) {
    await prisma.page.update({
      where: { id: page.id },
      data: { isRestricted: true, accessRootId: page.id },
    });
  }
  return page.id;
}

/** Version mit festem Zeitpunkt (Minuten vor jetzt). */
async function version(pageId: string, minutenVorher: number): Promise<string> {
  return (
    await prisma.pageVersion.create({
      data: {
        pageId,
        title: `${TAG}-version`,
        content: { type: "doc", content: [] },
        textContent: "",
        createdAt: new Date(Date.now() - minutenVorher * 60_000),
      },
      select: { id: true },
    })
  ).id;
}

async function meldung(data: {
  userId?: string;
  pageId: string;
  type?: "PAGE_UPDATED" | "MENTION";
  versionId?: string | null;
  minutenVorher?: number;
}): Promise<string> {
  return (
    await prisma.notification.create({
      data: {
        userId: data.userId ?? me.id,
        actorId: other,
        type: data.type ?? "PAGE_UPDATED",
        pageId: data.pageId,
        versionId: data.versionId ?? null,
        createdAt: new Date(Date.now() - (data.minutenVorher ?? 0) * 60_000),
      },
      select: { id: true },
    })
  ).id;
}

async function gelesen(id: string): Promise<boolean> {
  const row = await prisma.notification.findUniqueOrThrow({
    where: { id },
    select: { readAt: true },
  });
  return row.readAt !== null;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${TAG}-me@example.test`, name: "Ich", passwordHash: "x" },
    select: { id: true, email: true, name: true },
  });
  me = { ...user, isAdmin: false };
  other = (
    await prisma.user.create({
      data: { email: `${TAG}-other@example.test`, name: "Andere", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug,
        members: {
          create: [
            { userId: me.id, role: "MEMBER" },
            { userId: other, role: "OWNER" },
          ],
        },
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  // Benachrichtigungen haengen per Fremdschluessel an der Person.
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("/notifications/<id>", () => {
  it("fuehrt eine Aenderung auf den Stand davor gegen aktuell und setzt sie gelesen", async () => {
    mocks.actor = me;
    const pageId = await neueSeite();
    const v0 = await version(pageId, 60);
    const v1 = await version(pageId, 1);
    const id = await meldung({ pageId, versionId: v1, minutenVorher: 1 });
    expect(await oeffne(id)).toBe(
      `/s/${slug}/p/${pageId}/history/${v0}?against=current`,
    );
    expect(await gelesen(id)).toBe(true);
  });

  it("nimmt die naechstaeltere, wenn die vorherige Version ausgeduennt ist", async () => {
    mocks.actor = me;
    const pageId = await neueSeite();
    const v00 = await version(pageId, 120);
    const v0 = await version(pageId, 60);
    const v1 = await version(pageId, 1);
    await prisma.pageVersion.delete({ where: { id: v0 } });
    const id = await meldung({ pageId, versionId: v1, minutenVorher: 1 });
    expect(await oeffne(id)).toBe(
      `/s/${slug}/p/${pageId}/history/${v00}?against=current`,
    );
  });

  it("rechnet ohne die gemeldete Version vom Zeitpunkt der Meldung", async () => {
    mocks.actor = me;
    const pageId = await neueSeite();
    const v0 = await version(pageId, 60);
    const v1 = await version(pageId, 1);
    await prisma.pageVersion.delete({ where: { id: v1 } });
    const id = await meldung({ pageId, versionId: v1, minutenVorher: 1 });
    expect(await oeffne(id)).toBe(
      `/s/${slug}/p/${pageId}/history/${v0}?against=current`,
    );
  });

  it("fuehrt ohne aeltere Version auf die Seite", async () => {
    mocks.actor = me;
    const pageId = await neueSeite();
    const v1 = await version(pageId, 1);
    const id = await meldung({ pageId, versionId: v1, minutenVorher: 1 });
    expect(await oeffne(id)).toBe(`/s/${slug}/p/${pageId}`);
    expect(await gelesen(id)).toBe(true);
  });

  it("fuehrt eine Erwaehnung auf die Seite und setzt sie gelesen", async () => {
    mocks.actor = me;
    const pageId = await neueSeite();
    await version(pageId, 60);
    const id = await meldung({ pageId, type: "MENTION" });
    expect(await oeffne(id)).toBe(`/s/${slug}/p/${pageId}`);
    expect(await gelesen(id)).toBe(true);
  });

  it("verraet und veraendert fremde Meldungen nicht", async () => {
    mocks.actor = me;
    const pageId = await neueSeite();
    const id = await meldung({ pageId, userId: other });
    expect(await oeffne(id)).toBe("/notifications");
    expect(await gelesen(id)).toBe(false);
    expect(await oeffne("gibt-es-nicht")).toBe("/notifications");
  });

  it("fuehrt bei einer Seite ohne Zugriff zur Liste, setzt die eigene Zeile aber gelesen", async () => {
    mocks.actor = me;
    const pageId = await neueSeite({ isRestricted: true });
    const v1 = await version(pageId, 1);
    await version(pageId, 60);
    const id = await meldung({ pageId, versionId: v1, minutenVorher: 1 });
    expect(await oeffne(id)).toBe("/notifications");
    expect(await gelesen(id)).toBe(true);
  });

  it("schickt ohne Sitzung zur Anmeldung und kommt danach zurueck", async () => {
    mocks.actor = null;
    const pageId = await neueSeite();
    const id = await meldung({ pageId });
    expect(await oeffne(id)).toBe(
      `/login?next=${encodeURIComponent(`/notifications/${id}`)}`,
    );
    expect(await gelesen(id)).toBe(false);
  });
});

describe("markPageUpdatesRead", () => {
  it("setzt nur Aenderungsmeldungen dieser Person und Seite gelesen", async () => {
    vi.mocked(publishNotification).mockClear();
    const pageId = await neueSeite();
    const andereSeite = await neueSeite();
    const meine = await meldung({ pageId });
    const erwaehnung = await meldung({ pageId, type: "MENTION" });
    const fremde = await meldung({ pageId, userId: other });
    const anderswo = await meldung({ pageId: andereSeite });

    await markPageUpdatesRead(me.id, pageId);
    expect(await gelesen(meine)).toBe(true);
    expect(await gelesen(erwaehnung)).toBe(false);
    expect(await gelesen(fremde)).toBe(false);
    expect(await gelesen(anderswo)).toBe(false);
    expect(publishNotification).toHaveBeenCalledTimes(1);
    expect(publishNotification).toHaveBeenCalledWith([me.id]);

    // Nichts mehr offen: keine Nachricht an die Glocke.
    await markPageUpdatesRead(me.id, pageId);
    expect(publishNotification).toHaveBeenCalledTimes(1);
  });
});

describe("Liste der Benachrichtigungen", () => {
  it("zaehlt ungelesene Meldungen zu unsichtbaren Seiten mit, damit sie sich loeschen lassen", async () => {
    // Eigene Person, damit die Zaehlung nur diese Zeilen sieht.
    const user = await prisma.user.create({
      data: { email: `${TAG}-liste@example.test`, name: "Liste", passwordHash: "x" },
      select: { id: true, email: true, name: true },
    });
    await prisma.spaceMember.create({
      data: { spaceId, userId: user.id, role: "MEMBER" },
    });
    const weg = await neueSeite({ deletedAt: new Date() });
    const da = await neueSeite();
    const unsichtbar = await meldung({ pageId: weg, userId: user.id });
    const sichtbar = await meldung({
      pageId: da,
      userId: user.id,
      type: "MENTION",
    });
    await prisma.notification.update({
      where: { id: sichtbar },
      data: { readAt: new Date() },
    });

    const liste = await loadNotificationList(user.id);
    expect(liste.items.map((n) => n.id)).toEqual([sichtbar]);
    expect(liste.unreadTotal).toBe(1);

    mocks.actor = { ...user, isAdmin: false };
    await markAllReadAction();
    expect(await gelesen(unsichtbar)).toBe(true);
    expect((await loadNotificationList(user.id)).unreadTotal).toBe(0);
  });
});
