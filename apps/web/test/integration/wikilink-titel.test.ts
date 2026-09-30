import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@dokunc/db";

/**
 * Titel der Ziele von Wiki-Links.
 *
 * Ein Wiki-Link speichert den Titel seines Ziels als Schnappschuss. Wird
 * das Ziel später geschützt oder umbenannt, darf dieser Schnappschuss
 * nirgends mehr erscheinen, wo Lesende der verlinkenden Seite ihn sehen:
 * nicht in der Titel-Route des Editors, nicht im Export, im Druck, in der
 * Freigabe und im Versionsverlauf. Sichtbare Ziele zeigen den aktuellen
 * Titel, alle anderen einen festen Text. Export, Druck und Freigabe
 * verlassen die App und tragen keine internen IDs.
 *
 * Aufbau: Seite A verlinkt das Ziel B (Schnappschuss "Kündigung M.
 * Muster"), eine offene Seite O, ihre eigenen Unterseiten C und P und
 * eine Seite im Papierkorb, und erwähnt eine Person. Danach wird B
 * geschützt (frei nur für MF) und in "Vertrag 2026" umbenannt, P wird
 * geschützt (ohne Freigabe) und umbenannt, O und C werden umbenannt.
 */

type Nutzer = { id: string; email: string; name: string; isAdmin: boolean };
const aktuell: { nutzer: Nutzer | null } = { nutzer: null };

class Umleitung extends Error {}
class NichtGefunden extends Error {}

vi.mock("@/lib/current-user", () => ({
  getCurrentUser: async () => aktuell.nutzer,
  requireUser: async () => {
    if (!aktuell.nutzer) throw new Umleitung("/login");
    return aktuell.nutzer;
  },
  requireAdmin: async () => {
    if (!aktuell.nutzer?.isAdmin) throw new Umleitung("/spaces");
    return aktuell.nutzer;
  },
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    throw new Umleitung(url);
  },
  notFound: () => {
    throw new NichtGefunden();
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { renderToStaticMarkup } = await import("react-dom/server");
const { setPageRestricted } = await import("@/lib/page-access");
const { generateInviteToken } = await import("@/lib/invitations");
const { resolveShare } = await import("@/lib/share");
const { GET: exportGet } = await import("@/app/api/pages/[id]/export/route");
const { GET: printGet } = await import("@/app/p/[pageId]/print/route");
const { default: SharedPage } = await import("@/app/share/[id]/page");
const { default: VersionComparePage } = await import(
  "@/app/s/[slug]/p/[pageId]/history/[versionId]/page"
);

const TAG = `wltitel-${Date.now()}-${randomBytes(3).toString("hex")}`;
const SCHNAPPSCHUSS = "Kündigung M. Muster";
const NEU = "Vertrag 2026";

const n = {} as Record<"owner" | "me" | "mf" | "instanzAdmin", Nutzer>;
let spaceId: string;
let slug: string;
const s = {} as Record<"a" | "b" | "o" | "c" | "p" | "weg", string>;
let versionId: string;
/** Juengere Version von A: ihr Vergleich "gegen die vorherige" zeigt versionId. */
let neuereVersionId: string;

function inhaltVonA() {
  const link = (pageId: string, label: string) => ({
    type: "wikiLink",
    attrs: { pageId, label },
  });
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Siehe " },
          link(s.b, SCHNAPPSCHUSS),
          { type: "text", text: " und " },
          link(s.o, "Offen alt"),
          { type: "text", text: " und " },
          link(s.c, "Kind alt"),
          { type: "text", text: " und " },
          link(s.weg, "Weg alt"),
          { type: "text", text: " und geheim " },
          link(s.p, "Geheim alt"),
          { type: "text", text: " von " },
          { type: "mention", attrs: { userId: n.mf.id, name: "Alex" } },
        ],
      },
    ],
  };
}

async function nutzer(name: string, isAdmin = false): Promise<Nutzer> {
  const email = `${TAG}-${name}@example.test`;
  const u = await prisma.user.create({
    data: { email, name, passwordHash: "x", isAdmin },
    select: { id: true },
  });
  return { id: u.id, email, name, isAdmin };
}

async function seite(title: string, parentId: string | null = null) {
  return (
    await prisma.page.create({
      data: { spaceId, title, parentId },
      select: { id: true },
    })
  ).id;
}

beforeAll(async () => {
  n.owner = await nutzer("owner");
  n.me = await nutzer("me");
  n.mf = await nutzer("mf");
  n.instanzAdmin = await nutzer("admin", true);
  slug = TAG;
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug,
        members: {
          create: [
            { userId: n.owner.id, role: "OWNER" },
            { userId: n.me.id, role: "MEMBER" },
            { userId: n.mf.id, role: "MEMBER" },
          ],
        },
      },
      select: { id: true },
    })
  ).id;
  s.a = await seite("Quelle");
  s.b = await seite(SCHNAPPSCHUSS);
  s.o = await seite("Offen alt");
  s.c = await seite("Kind alt", s.a);
  s.p = await seite("Geheim alt", s.a);
  s.weg = await seite("Weg alt");
  await prisma.page.update({
    where: { id: s.a },
    data: { content: inhaltVonA() },
  });
  versionId = (
    await prisma.pageVersion.create({
      data: { pageId: s.a, title: "Quelle", content: inhaltVonA() },
      select: { id: true },
    })
  ).id;
  const nachtrag = inhaltVonA();
  nachtrag.content.push({
    type: "paragraph",
    content: [{ type: "text", text: "Nachtrag" }],
  });
  neuereVersionId = (
    await prisma.pageVersion.create({
      data: {
        pageId: s.a,
        title: "Quelle",
        content: nachtrag,
        createdAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    })
  ).id;

  // Erst nach dem Verlinken: das Ziel wird geschützt und umbenannt.
  await setPageRestricted(s.b, true, n.owner.id);
  await prisma.pageGrant.create({ data: { pageId: s.b, userId: n.mf.id } });
  await prisma.page.update({ where: { id: s.b }, data: { title: NEU } });
  await prisma.page.update({ where: { id: s.o }, data: { title: "Offen neu" } });
  await prisma.page.update({ where: { id: s.c }, data: { title: "Kind neu" } });
  // Eine Unterseite von A, also innerhalb einer Freigabe mit Unterseiten.
  await setPageRestricted(s.p, true, n.owner.id);
  await prisma.page.update({ where: { id: s.p }, data: { title: "Geheim neu" } });
  await prisma.page.update({ where: { id: s.weg }, data: { deletedAt: new Date() } });
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}-` } } });
});

async function als<T>(u: Nutzer | null, fn: () => Promise<T>): Promise<T> {
  aktuell.nutzer = u;
  try {
    return await fn();
  } finally {
    aktuell.nutzer = null;
  }
}

/** Kein Schnappschuss, kein alter Titel eines anderen Ziels. */
function ohneSchnappschuesse(text: string) {
  for (const alt of [
    SCHNAPPSCHUSS,
    "Kündigung",
    "Offen alt",
    "Kind alt",
    "Weg alt",
    "Geheim alt",
  ]) {
    expect(text).not.toContain(alt);
  }
}

describe("titlesForUser", () => {
  it("nennt den aktuellen Titel nur, wer das Ziel öffnen darf", async () => {
    const { titlesForUser } = await import("@/lib/link-titles");
    const ids = [s.b, s.o, s.weg];
    const me = await titlesForUser(n.me.id, ids);
    expect(me.get(s.b)).toBeNull();
    expect(me.get(s.o)).toBe("Offen neu");
    expect(me.get(s.weg)).toBeNull();
    for (const u of [n.mf, n.owner]) {
      expect((await titlesForUser(u.id, ids)).get(s.b)).toBe(NEU);
    }
    // Instanz-Admin ohne Mitgliedschaft: kein Inhaltszugriff.
    const admin = await titlesForUser(n.instanzAdmin.id, ids);
    expect(admin.get(s.b)).toBeNull();
    expect(admin.get(s.o)).toBeNull();
  });
});

describe("GET /api/pages/titles", () => {
  async function titel(u: Nutzer | null, ids: string) {
    const { GET } = await import("@/app/api/pages/titles/route");
    return als(u, () =>
      GET(new Request(`http://localhost/api/pages/titles?ids=${encodeURIComponent(ids)}`)),
    );
  }

  it("als MEMBER ohne Freigabe: null statt Titel, nichts vom Schnappschuss", async () => {
    const res = await titel(n.me, `${s.b},${s.o},${s.b}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ titles: { [s.b]: null, [s.o]: "Offen neu" } });
    expect(text).not.toContain("Kündigung");
    expect(text).not.toContain(NEU);
  });

  it("als MEMBER mit Freigabe: der aktuelle Titel", async () => {
    const res = await titel(n.mf, s.b);
    expect(await res.json()).toEqual({ titles: { [s.b]: NEU } });
  });

  it("ohne Anmeldung 401", async () => {
    expect((await titel(null, s.b)).status).toBe(401);
  });

  it("mehr als 100 IDs oder keine: 400", async () => {
    const viele = Array.from({ length: 101 }, (_, i) => `c${String(i).padStart(24, "0")}`);
    expect((await titel(n.me, viele.join(","))).status).toBe(400);
    expect((await titel(n.me, "")).status).toBe(400);
  });

  it("eine ungültige ID kippt den Stapel nicht, sie ist null", async () => {
    const res = await titel(n.me, `${s.o},../../etc`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      titles: { [s.o]: "Offen neu", "../../etc": null },
    });
  });
});

describe("Export und Druck", () => {
  async function exportiere(u: Nutzer, format: "md" | "html") {
    const res = await als(u, () =>
      exportGet(new Request(`http://localhost/api/pages/${s.a}/export?format=${format}`), {
        params: Promise.resolve({ id: s.a }),
      }),
    );
    expect(res.status).toBe(200);
    return res.text();
  }

  async function drucke(u: Nutzer) {
    const res = await als(u, () =>
      printGet(new Request(`http://localhost/p/${s.a}/print`), {
        params: Promise.resolve({ pageId: s.a }),
      }),
    );
    expect(res.status).toBe(200);
    return res.text();
  }

  for (const format of ["md", "html"] as const) {
    it(`${format} als MEMBER ohne Freigabe: kein Titel des Ziels`, async () => {
      const text = await exportiere(n.me, format);
      ohneSchnappschuesse(text);
      expect(text).not.toContain(NEU);
      expect(text).toContain("Seite ohne Zugriff");
      expect(text).toContain("Offen neu");
      expect(text).not.toContain("/p/");
    });

    it(`${format} als MEMBER mit Freigabe: aktueller Titel, keine internen IDs`, async () => {
      const text = await exportiere(n.mf, format);
      ohneSchnappschuesse(text);
      expect(text).toContain(NEU);
      expect(text).toContain("Kind neu");
      expect(text).not.toContain("/p/");
      expect(text).not.toContain(s.b);
      expect(text).not.toContain(n.mf.id);
    });
  }

  it("Druck als MEMBER ohne Freigabe: kein Titel des Ziels", async () => {
    const text = await drucke(n.me);
    ohneSchnappschuesse(text);
    expect(text).not.toContain(NEU);
    expect(text).toContain("Seite ohne Zugriff");
    expect(text).not.toContain("/p/");
    expect(text).not.toContain("data-page-id");
    expect(text).not.toContain("data-user-id");
  });

  it("Druck als MEMBER mit Freigabe: aktueller Titel", async () => {
    const text = await drucke(n.mf);
    ohneSchnappschuesse(text);
    expect(text).toContain(NEU);
  });
});

describe("Freigabe", () => {
  async function freigabe(includeChildren: boolean) {
    const { token, tokenHash } = generateInviteToken();
    const share = await prisma.pageShare.create({
      data: { pageId: s.a, tokenHash, createdById: n.owner.id, includeChildren },
      select: { id: true },
    });
    return { id: share.id, token };
  }

  async function geteilt(includeChildren: boolean) {
    const f = await freigabe(includeChildren);
    const { sharedContentHtml } = await import("@/lib/share");
    const share = await resolveShare(f.id, f.token);
    expect(share).not.toBeNull();
    const html = await sharedContentHtml(share!, f.token);
    const seite = renderToStaticMarkup(
      await SharedPage({
        params: Promise.resolve({ id: f.id }),
        searchParams: Promise.resolve({ token: f.token }),
      }),
    );
    return { html, seite };
  }

  it("nur die Seite: kein Titel eines Ziels, keine internen IDs", async () => {
    const { html, seite } = await geteilt(false);
    for (const text of [html, seite]) {
      ohneSchnappschuesse(text);
      expect(text).not.toContain(NEU);
      // Offen, aber nicht Teil der Freigabe: auch der neue Titel nicht.
      expect(text).not.toContain("Offen neu");
      expect(text).not.toContain("Kind neu");
      expect(text).toContain("Verknüpfte Seite");
      expect(text).toContain("@Alex");
      expect(text).not.toContain("data-page-id");
      expect(text).not.toContain("data-user-id");
      expect(text).not.toContain("/p/");
      expect(text).not.toContain(n.mf.id);
    }
  });

  it("mit Unterseiten: Titel der Unterseiten der Freigabe, sonst nichts", async () => {
    const { html } = await geteilt(true);
    ohneSchnappschuesse(html);
    expect(html).toContain("Kind neu");
    expect(html).not.toContain("Offen neu");
    expect(html).not.toContain(NEU);
    expect(html).not.toContain("/p/");
  });

  it("mit Unterseiten: eine geschützte Unterseite bleibt ohne Titel", async () => {
    // P hängt unter der freigegebenen Seite, ist aber geschützt: der
    // Link öffnet sie nicht, also nennt er auch ihren Titel nicht.
    const { html, seite } = await geteilt(true);
    for (const text of [html, seite]) {
      ohneSchnappschuesse(text);
      expect(text).not.toContain("Geheim neu");
      expect(text).toMatch(/geheim <span[^>]*>Verknüpfte Seite<\/span>/);
      expect(text).not.toContain(s.p);
    }
  });
});

describe("Versionsverlauf", () => {
  async function verlauf(u: Nutzer, view: "diff" | "preview") {
    return als(u, async () =>
      renderToStaticMarkup(
        await VersionComparePage({
          params: Promise.resolve({ slug, pageId: s.a, versionId }),
          searchParams: Promise.resolve({ view, against: "current" }),
        }),
      ),
    );
  }

  for (const view of ["diff", "preview"] as const) {
    it(`${view} als MEMBER ohne Freigabe: kein Titel des Ziels`, async () => {
      const html = await verlauf(n.me, view);
      ohneSchnappschuesse(html);
      expect(html).not.toContain(NEU);
      expect(html).toContain("Seite ohne Zugriff");
    });

    it(`${view} als MEMBER mit Freigabe: aktueller Titel`, async () => {
      const html = await verlauf(n.mf, view);
      ohneSchnappschuesse(html);
      expect(html).toContain(NEU);
    });
  }

  it("die Vorschau in der App behält Links auf sichtbare Ziele", async () => {
    const html = await verlauf(n.mf, "preview");
    expect(html).toContain(`href="/p/${s.b}"`);
    expect(html).not.toContain(`href="/p/${s.weg}"`);
  });

  it("gegen die vorherige Version als MEMBER ohne Freigabe: kein Titel des Ziels", async () => {
    const html = await als(n.me, async () =>
      renderToStaticMarkup(
        await VersionComparePage({
          params: Promise.resolve({ slug, pageId: s.a, versionId: neuereVersionId }),
          searchParams: Promise.resolve({ view: "diff", against: "previous" }),
        }),
      ),
    );
    // Voraussetzung: verglichen wird wirklich mit der vorherigen Version.
    expect(html).toContain("Vorherige Version");
    expect(html).toContain("Nachtrag");
    ohneSchnappschuesse(html);
    expect(html).not.toContain(NEU);
    expect(html).toContain("Seite ohne Zugriff");
  });
});
