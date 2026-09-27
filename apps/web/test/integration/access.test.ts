import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, usersWhoCanSeePage } from "@dokunc/db";
import { effectiveRole, accessibleSpaces } from "@/lib/space-access";
import {
  canSeePage,
  refreshAccessRoots,
  setPageRestricted,
  visiblePagesAcrossSpaces,
  visiblePageWhere,
} from "@/lib/page-access";
import {
  findLivePage,
  livePageWhere,
  movePageInSpace,
  scopeOf,
  scopeVisibleSql,
  scopeWhere,
  selectLivePage,
  type PageScope,
} from "@/lib/page-guards";
import { loadAncestors } from "@/lib/page-ancestors";

/**
 * Gruppen und geschützte Seiten.
 *
 * Beide Regeln leben in Abfragen, nicht im Code: die wirksame Rolle ist
 * das Stärkste aus Mitgliedschaft und Gruppen, und die Sichtbarkeit
 * hängt an der materialisierten Schutzwurzel. Ein Mock würde genau das
 * nachbauen, was zu prüfen ist — also läuft alles gegen echtes Postgres.
 */

const TAG = `acc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let spaceId: string;
/** Direktes Mitglied, in keiner Gruppe. */
let plain: string;
/** Zugang nur über eine Gruppe. */
let viaGroup: string;
/** Direkt MEMBER und zusätzlich in einer ADMIN-Gruppe. */
let both: string;
/** Verwaltung des Space. */
let manager: string;
let groupId: string;
let adminGroupId: string;

let openPageId: string;
let secretPageId: string;
let secretChildId: string;

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
  [plain, viaGroup, both, manager] = await Promise.all([
    makeUser("plain"),
    makeUser("group"),
    makeUser("both"),
    makeUser("manager"),
  ]);

  const space = await prisma.space.create({
    data: {
      name: `${TAG}-space`,
      slug: `${TAG}-space`,
      members: {
        create: [
          { userId: plain, role: "MEMBER" },
          { userId: both, role: "MEMBER" },
          { userId: manager, role: "ADMIN" },
        ],
      },
    },
    select: { id: true },
  });
  spaceId = space.id;

  const group = await prisma.group.create({
    data: {
      name: `${TAG}-lesegruppe`,
      members: { create: [{ userId: viaGroup }] },
      spaces: { create: [{ spaceId, role: "VIEWER" }] },
    },
    select: { id: true },
  });
  groupId = group.id;

  const adminGroup = await prisma.group.create({
    data: {
      name: `${TAG}-leitung`,
      members: { create: [{ userId: both }] },
      spaces: { create: [{ spaceId, role: "ADMIN" }] },
    },
    select: { id: true },
  });
  adminGroupId = adminGroup.id;

  const open = await prisma.page.create({
    data: { spaceId, title: "Offen" },
    select: { id: true },
  });
  openPageId = open.id;
  const secret = await prisma.page.create({
    data: { spaceId, title: "Geheim" },
    select: { id: true },
  });
  secretPageId = secret.id;
  const child = await prisma.page.create({
    data: { spaceId, parentId: secretPageId, title: "Geheimes Kind" },
    select: { id: true },
  });
  secretChildId = child.id;

  // Schutz setzen: die handelnde Person ist "plain", damit die Tests
  // eine eingetragene und eine nicht eingetragene Person haben.
  await setPageRestricted(secretPageId, true, plain);
  await refreshAccessRoots(secretPageId);
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.group.deleteMany({
    where: { id: { in: [groupId, adminGroupId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [plain, viaGroup, both, manager] } },
  });
});

describe("Wirksame Rolle", () => {
  it("nimmt die eigene Mitgliedschaft", async () => {
    expect(await effectiveRole(plain, spaceId)).toBe("MEMBER");
  });

  it("gibt Zugang allein über eine Gruppe", async () => {
    expect(await effectiveRole(viaGroup, spaceId)).toBe("VIEWER");
  });

  it("nimmt die stärkere von beiden", async () => {
    // Direkt MEMBER, über die Gruppe ADMIN: ADMIN gewinnt.
    expect(await effectiveRole(both, spaceId)).toBe("ADMIN");
  });

  it("gibt niemandem sonst eine Rolle", async () => {
    const stranger = await makeUser("stranger");
    expect(await effectiveRole(stranger, spaceId)).toBeNull();
    await prisma.user.delete({ where: { id: stranger } });
  });

  it("listet den Space auch für reine Gruppenmitglieder", async () => {
    const spaces = await accessibleSpaces(viaGroup);
    expect(spaces).toEqual([{ spaceId, role: "VIEWER" }]);
  });
});

describe("Geschützte Seiten", () => {
  it("lässt offene Seiten für alle sichtbar", async () => {
    expect(await canSeePage(openPageId, viaGroup, "VIEWER")).toBe(true);
  });

  it("zeigt die geschützte Seite nur den Eingetragenen", async () => {
    // "plain" hat den Schutz gesetzt und steht damit selbst drin.
    expect(await canSeePage(secretPageId, plain, "MEMBER")).toBe(true);
    expect(await canSeePage(secretPageId, viaGroup, "VIEWER")).toBe(false);
  });

  it("vererbt den Schutz auf Unterseiten", async () => {
    expect(await canSeePage(secretChildId, viaGroup, "VIEWER")).toBe(false);
    expect(await canSeePage(secretChildId, plain, "MEMBER")).toBe(true);
  });

  it("lässt die Space-Verwaltung immer durch", async () => {
    expect(await canSeePage(secretPageId, manager, "ADMIN")).toBe(true);
    expect(await canSeePage(secretChildId, manager, "ADMIN")).toBe(true);
  });

  it("öffnet die Seite über eine freigegebene Gruppe", async () => {
    await prisma.pageGrant.create({
      data: { pageId: secretPageId, groupId },
    });
    try {
      expect(await canSeePage(secretPageId, viaGroup, "VIEWER")).toBe(true);
      expect(await canSeePage(secretChildId, viaGroup, "VIEWER")).toBe(true);
    } finally {
      await prisma.pageGrant.deleteMany({
        where: { pageId: secretPageId, groupId },
      });
    }
  });

  it("nimmt den Schutz mitsamt Freigaben wieder zurück", async () => {
    const page = await prisma.page.create({
      data: { spaceId, title: "Kurz geschützt" },
      select: { id: true },
    });
    await setPageRestricted(page.id, true, plain);
    expect(await canSeePage(page.id, viaGroup, "VIEWER")).toBe(false);

    await setPageRestricted(page.id, false, plain);
    expect(await canSeePage(page.id, viaGroup, "VIEWER")).toBe(true);
    expect(
      await prisma.pageGrant.count({ where: { pageId: page.id } }),
    ).toBe(0);
    await prisma.page.delete({ where: { id: page.id } });
  });
});

describe("Sichtbarkeit in Abfragen", () => {
  it("blendet geschützte Seiten aus der Liste aus", async () => {
    const visible = await prisma.page.findMany({
      where: {
        spaceId,
        deletedAt: null,
        ...visiblePageWhere(viaGroup, "VIEWER"),
      },
      select: { id: true },
    });
    const ids = visible.map((p) => p.id);
    expect(ids).toContain(openPageId);
    expect(ids).not.toContain(secretPageId);
    expect(ids).not.toContain(secretChildId);
  });

  it("zeigt der Verwaltung alles", async () => {
    const visible = await prisma.page.findMany({
      where: {
        spaceId,
        deletedAt: null,
        ...visiblePageWhere(manager, "ADMIN"),
      },
      select: { id: true },
    });
    expect(visible.map((p) => p.id)).toEqual(
      expect.arrayContaining([openPageId, secretPageId, secretChildId]),
    );
  });

  it("findet ohne Space gar nichts", async () => {
    const none = await prisma.page.findMany({
      where: visiblePagesAcrossSpaces(plain, []),
      select: { id: true },
    });
    expect(none).toHaveLength(0);
  });

  it("verweigert den Schreib-Guard für eine unsichtbare Seite", async () => {
    const scope = { spaceId, userId: viaGroup, role: "VIEWER" as const };
    expect(await findLivePage(scope, openPageId)).not.toBeNull();
    expect(await findLivePage(scope, secretPageId)).toBeNull();
  });
});

/**
 * Der flache Seitenbaum hinter /api/spaces/[id]/pages. Die Route hat
 * ihren Zugang lange allein an SpaceMember gehaengt und ohne
 * Sichtbarkeit geliefert: Gruppenmitglieder bekamen 403, und wer
 * hineinkam, sah die Titel geschuetzter Seiten. Beides steht hier fest.
 */
/**
 * Die Kruemelspur. Wer auf einer geschuetzten Seite eine Freigabe hat,
 * sieht diese Seite zu Recht — die Titel der geschuetzten Seiten
 * darueber aber nicht. Ohne Filter stand genau das in der Krume.
 */
describe("Kruemelspur", () => {
  let hiddenTop: string;
  let middle: string;
  let grantedLeaf: string;

  beforeAll(async () => {
    const top = await prisma.page.create({
      data: { spaceId, title: "Verborgene Wurzel" },
      select: { id: true },
    });
    hiddenTop = top.id;
    const mid = await prisma.page.create({
      data: { spaceId, parentId: hiddenTop, title: "Zwischenseite" },
      select: { id: true },
    });
    middle = mid.id;
    const leaf = await prisma.page.create({
      data: { spaceId, parentId: middle, title: "Freigegebenes Blatt" },
      select: { id: true },
    });
    grantedLeaf = leaf.id;

    // Oben geschuetzt (ohne Freigabe), unten geschuetzt MIT Freigabe fuer
    // die Gruppe: das Blatt ist sichtbar, sein Weg dorthin nicht.
    await setPageRestricted(hiddenTop, true, plain);
    await setPageRestricted(grantedLeaf, true, plain);
    await prisma.pageGrant.create({
      data: { pageId: grantedLeaf, groupId },
    });
    await refreshAccessRoots(hiddenTop);
  });

  afterAll(async () => {
    await prisma.page.deleteMany({ where: { id: hiddenTop } });
  });

  it("zeigt das Blatt, weil die Gruppe freigegeben ist", async () => {
    expect(await canSeePage(grantedLeaf, viaGroup, "VIEWER")).toBe(true);
    expect(await canSeePage(middle, viaGroup, "VIEWER")).toBe(false);
  });

  it("nennt die verborgenen Elternseiten nicht", async () => {
    const crumbs = await loadAncestors(spaceId, middle, viaGroup, "VIEWER");
    expect(crumbs).toEqual([]);
  });

  it("zeigt der Verwaltung den ganzen Weg", async () => {
    const crumbs = await loadAncestors(spaceId, middle, manager, "ADMIN");
    expect(crumbs.map((c) => c.title)).toEqual([
      "Verborgene Wurzel",
      "Zwischenseite",
    ]);
  });
});

describe("Seitenbaum für Auswahl-Dialoge", () => {
  async function treeFor(userId: string) {
    const role = await effectiveRole(userId, spaceId);
    if (!role) return null;
    const pages = await prisma.page.findMany({
      where: {
        spaceId,
        deletedAt: null,
        isTemplate: false,
        ...visiblePageWhere(userId, role),
      },
      select: { id: true },
    });
    return pages.map((p) => p.id);
  }

  it("liefert ihn auch, wenn der Zugang nur über eine Gruppe kommt", async () => {
    const ids = await treeFor(viaGroup);
    expect(ids).not.toBeNull();
    expect(ids).toContain(openPageId);
  });

  it("lässt geschützte Seiten weg, statt ihre Titel zu zeigen", async () => {
    const ids = await treeFor(viaGroup);
    expect(ids).not.toContain(secretPageId);
    expect(ids).not.toContain(secretChildId);
  });

  it("zeigt der Verwaltung den ganzen Baum", async () => {
    const ids = await treeFor(manager);
    expect(ids).toEqual(
      expect.arrayContaining([openPageId, secretPageId, secretChildId]),
    );
  });
});

describe("Umhängen im Baum", () => {
  it("nimmt den Schutz beim Verschieben mit und wieder weg", async () => {
    const page = await prisma.page.create({
      data: { spaceId, title: "Wanderseite" },
      select: { id: true },
    });
    const scope = { spaceId, userId: manager, role: "ADMIN" as const };
    try {
      expect(await canSeePage(page.id, viaGroup, "VIEWER")).toBe(true);

      // Unter die geschützte Seite: ab jetzt geschützt.
      expect((await movePageInSpace(scope, page.id, secretPageId, 0)).ok).toBe(
        true,
      );
      expect(await canSeePage(page.id, viaGroup, "VIEWER")).toBe(false);

      // Wieder heraus: der Schutz endet mit dem Umhängen.
      expect((await movePageInSpace(scope, page.id, null, 0)).ok).toBe(true);
      expect(await canSeePage(page.id, viaGroup, "VIEWER")).toBe(true);
    } finally {
      await prisma.page.delete({ where: { id: page.id } });
    }
  });
});

/**
 * Die zentralen Guards in den Varianten, auf die sich Vorlagen,
 * Duplizieren und Favoriten stuetzen. Diese Aktionen formulierten die
 * Bindung an Space und Sichtbarkeit frueher jede fuer sich aus — und
 * genau dort fehlte der Sichtbarkeitsteil. Jetzt beziehen sie sie von
 * hier, also steht hier fest, was sie pruefen.
 */
describe("Guards für Vorlagen, Duplizieren und Favoriten", () => {
  let templateId: string;
  const viewer = (): PageScope => ({ spaceId, userId: viaGroup, role: "VIEWER" });
  const admin = (): PageScope => ({ spaceId, userId: manager, role: "ADMIN" });

  beforeAll(async () => {
    const template = await prisma.page.create({
      data: { spaceId, title: "Vorlage", isTemplate: true },
      select: { id: true },
    });
    templateId = template.id;
  });

  afterAll(async () => {
    await prisma.page.deleteMany({ where: { id: templateId } });
  });

  it("baut den Kontext aus dem Ergebnis von authorizeAction", () => {
    expect(
      scopeOf({
        space: { id: spaceId },
        user: { id: viaGroup },
        role: "VIEWER",
      }),
    ).toEqual(viewer());
  });

  it("unterscheidet Vorlagen und Seiten nur auf Wunsch", async () => {
    // Favoriten und Elternseiten: keine Vorlagen.
    expect(
      await findLivePage(viewer(), templateId, { isTemplate: false }),
    ).toBeNull();
    expect(
      await findLivePage(viewer(), openPageId, { isTemplate: false }),
    ).not.toBeNull();
    // Neue Seite aus einer Vorlage: nur Vorlagen.
    expect(
      await findLivePage(viewer(), openPageId, { isTemplate: true }),
    ).toBeNull();
    expect(
      await findLivePage(viewer(), templateId, { isTemplate: true }),
    ).not.toBeNull();
    // Duplizieren und "Als Vorlage speichern": beides.
    expect(await findLivePage(viewer(), templateId)).not.toBeNull();
  });

  it("liefert den Inhalt einer geschützten Seite nicht aus", async () => {
    expect(
      await selectLivePage(viewer(), secretPageId, {
        title: true,
        content: true,
      }),
    ).toBeNull();
    expect(
      await selectLivePage(admin(), secretPageId, { title: true }),
    ).toEqual({ title: "Geheim" });
  });

  it("findet keine Seite im Papierkorb", async () => {
    const trashed = await prisma.page.create({
      data: { spaceId, title: "Weg", deletedAt: new Date() },
      select: { id: true },
    });
    try {
      expect(
        await selectLivePage(admin(), trashed.id, { id: true }),
      ).toBeNull();
      expect(
        await prisma.page.count({ where: livePageWhere(admin(), trashed.id) }),
      ).toBe(0);
    } finally {
      await prisma.page.delete({ where: { id: trashed.id } });
    }
  });

  it("bindet auch Schreibzugriffe an die Sichtbarkeit", async () => {
    // Wie beim Löschen einer Vorlage: dieselbe Bedingung in updateMany.
    expect(
      await prisma.page.count({
        where: livePageWhere(viewer(), secretPageId),
      }),
    ).toBe(0);
    expect(
      await prisma.page.count({
        where: livePageWhere(viewer(), templateId, { isTemplate: true }),
      }),
    ).toBe(1);
  });

  it("hält beim Laden mehrerer Seiten die geschützten zurück", async () => {
    const ids = [openPageId, secretPageId, secretChildId];
    const forViewer = await prisma.page.findMany({
      where: { id: { in: ids }, ...scopeWhere(viewer()) },
      select: { id: true },
    });
    expect(forViewer.map((p) => p.id)).toEqual([openPageId]);
    const forAdmin = await prisma.page.findMany({
      where: { id: { in: ids }, ...scopeWhere(admin()) },
      select: { id: true },
    });
    expect(forAdmin.map((p) => p.id).sort()).toEqual([...ids].sort());
  });

  it("hält den Unterbaum in Rohabfragen an der geschützten Seite an", async () => {
    async function sichtbar(scope: PageScope) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM "Page" p
        WHERE p."spaceId" = ${spaceId}
          AND p.id IN (${openPageId}, ${secretPageId}, ${secretChildId})
          AND ${scopeVisibleSql(scope)}
      `;
      return rows.map((r) => r.id).sort();
    }
    expect(await sichtbar(viewer())).toEqual([openPageId]);
    expect(await sichtbar(admin())).toEqual(
      [openPageId, secretPageId, secretChildId].sort(),
    );
  });
});

// Der Collab-Server prueft damit alle Folgenden einer Seite auf einmal
// (Aenderungsmeldungen). Dieselbe Regel wie canSeePage, nur gebuendelt.
describe("usersWhoCanSeePage", () => {
  it("laesst auf einer offenen Seite Mitglieder und Gruppenmitglieder durch, Fremde nicht", async () => {
    const stranger = await makeUser("uwcsp-fremd");
    try {
      expect(
        await usersWhoCanSeePage(openPageId, [plain, stranger, viaGroup]),
      ).toEqual([plain, viaGroup]);
    } finally {
      await prisma.user.delete({ where: { id: stranger } });
    }
  });

  it("laesst auf einer geschuetzten Seite nur Eingetragene und die Verwaltung durch", async () => {
    // plain steht selbst drin (hat den Schutz gesetzt), manager und both
    // verwalten den Space, viaGroup hat keine Freigabe.
    const alle = [viaGroup, plain, manager, both];
    expect(await usersWhoCanSeePage(secretPageId, alle)).toEqual([
      plain,
      manager,
      both,
    ]);
    expect(await usersWhoCanSeePage(secretChildId, alle)).toEqual([
      plain,
      manager,
      both,
    ]);

    // Freigabe fuer die Gruppe: jetzt auch viaGroup, auf der Seite und
    // auf der Unterseite (gleiche Schutzwurzel).
    await prisma.pageGrant.create({ data: { pageId: secretPageId, groupId } });
    try {
      expect(await usersWhoCanSeePage(secretChildId, alle)).toEqual(alle);
    } finally {
      await prisma.pageGrant.deleteMany({
        where: { pageId: secretPageId, groupId },
      });
    }
  });

  it("liefert fuer eine Seite im Papierkorb niemanden", async () => {
    const page = await prisma.page.create({
      data: { spaceId, title: "Weg", deletedAt: new Date() },
      select: { id: true },
    });
    try {
      expect(await usersWhoCanSeePage(page.id, [plain, manager])).toEqual([]);
      expect(await usersWhoCanSeePage("gibt-es-nicht", [plain])).toEqual([]);
    } finally {
      await prisma.page.delete({ where: { id: page.id } });
    }
  });

  it("nennt Doppelte nur einmal, in der Reihenfolge der Eingabe", async () => {
    expect(
      await usersWhoCanSeePage(openPageId, [viaGroup, plain, viaGroup, plain]),
    ).toEqual([viaGroup, plain]);
  });
});
