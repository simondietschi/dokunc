import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  countCollabDocumentsOver,
  largestCollabDocuments,
  prisma,
} from "@dokunc/db";
import { readDocSizeLimits } from "@dokunc/editor";
import { log } from "@/lib/log";
import { largestDocumentsFor } from "@/lib/doc-sizes";

/**
 * Groesse der gespeicherten Yjs-Staende (Admin-Liste /admin/documents,
 * Startcheck des Collab-Servers), ohne Collab-Server.
 *
 * Gemessen wird mit octet_length, der Rohgroesse. Die 200 KB aus
 * Nullbytes speichert Postgres komprimiert: pg_column_size naennte dort
 * nur ein paar Bytes, und eine grosse Seite fiele durch.
 */

const TAG = `dsz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KB = 1024;

let adminId: string;
let spaceA: string;
let spaceB: string;
/** 200 KB Nullbytes, offene Seite in A. */
let nullen: string;
/** 50 KB Zufall, geschuetzte Seite in A ohne Freigabe. */
let zufall: string;
/** 10 Bytes, Seite in B (Admin nicht Mitglied). */
let klein: string;
/** 1.5 MB, offene Seite in A. */
let gross: string;
/** 20 KB, Seite in A im Papierkorb. */
let papierkorb: string;

async function seite(
  spaceId: string,
  name: string,
  state: Buffer | null,
  extra: { deletedAt?: Date } = {},
): Promise<string> {
  const id = (
    await prisma.page.create({
      data: { spaceId, title: `${TAG}-${name}`, ...extra },
      select: { id: true },
    })
  ).id;
  if (state) {
    await prisma.collabDocument.create({
      data: { pageId: id, state: Buffer.from(state) },
    });
  }
  return id;
}

beforeAll(async () => {
  adminId = (
    await prisma.user.create({
      data: {
        email: `${TAG}-admin@example.test`,
        name: "Admin",
        passwordHash: "x",
        isAdmin: true,
      },
      select: { id: true },
    })
  ).id;
  spaceA = (
    await prisma.space.create({
      data: {
        name: `${TAG}-a`,
        slug: `${TAG}-a`,
        members: { create: [{ userId: adminId, role: "VIEWER" }] },
      },
      select: { id: true },
    })
  ).id;
  spaceB = (
    await prisma.space.create({
      data: { name: `${TAG}-b`, slug: `${TAG}-b` },
      select: { id: true },
    })
  ).id;

  nullen = await seite(spaceA, "nullen", Buffer.alloc(200 * KB));
  zufall = await seite(spaceA, "zufall", randomBytes(50 * KB));
  // Geschuetzt: die Seite ist ihre eigene Schutzwurzel, ohne Freigabe.
  await prisma.page.update({
    where: { id: zufall },
    data: { isRestricted: true, accessRootId: zufall },
  });
  klein = await seite(spaceB, "klein", Buffer.alloc(10, 7));
  gross = await seite(spaceA, "gross", Buffer.alloc(1.5 * 1024 * KB, 1));
  papierkorb = await seite(spaceA, "papierkorb", Buffer.alloc(20 * KB, 2), {
    deletedAt: new Date(),
  });
}, 30_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.space.deleteMany({
    where: { id: { in: [spaceA, spaceB].filter(Boolean) } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("largestCollabDocuments()", () => {
  it("misst die Rohgroesse, absteigend, auch bei komprimierter Speicherung", async () => {
    const eigene = new Set([nullen, zufall, klein]);
    const rows = (await largestCollabDocuments(1000)).filter((r) =>
      eigene.has(r.pageId),
    );
    expect(rows.map((r) => [r.pageId, r.bytes])).toEqual([
      [nullen, 200 * KB],
      [zufall, 50 * KB],
      [klein, 10],
    ]);
    const erste = rows[0]!;
    expect(erste.title).toBe(`${TAG}-nullen`);
    expect(erste.spaceId).toBe(spaceA);
    expect(erste.spaceName).toBe(`${TAG}-a`);
    expect(erste.spaceSlug).toBe(`${TAG}-a`);
    expect(erste.deletedAt).toBeNull();
    expect(erste.updatedAt).toBeInstanceOf(Date);
  });
});

describe("countCollabDocumentsOver()", () => {
  it("zaehlt genau die Staende echt ueber der Grenze", async () => {
    const vorher = await countCollabDocumentsOver(100 * KB);
    const neu = await seite(spaceA, "zaehler", Buffer.alloc(200 * KB));
    const nachher = await countCollabDocumentsOver(100 * KB);
    expect(nachher - vorher).toBe(1);
    // Genau auf der Grenze zaehlt nicht mit.
    const genau = await countCollabDocumentsOver(200 * KB);
    await prisma.collabDocument.update({
      where: { pageId: neu },
      data: { state: Buffer.alloc(200 * KB + 1) },
    });
    expect((await countCollabDocumentsOver(200 * KB)) - genau).toBe(1);
  });
});

describe("largestDocumentsFor()", () => {
  it("bestimmt die Stufe nach COLLAB_MAX_DOC_MB", async () => {
    vi.stubEnv("COLLAB_MAX_DOC_MB", "1");
    const { rows, limits } = await largestDocumentsFor(adminId, 1000);
    expect(limits.maxDocBytes).toBe(1024 * KB);
    const zeile = (id: string) => rows.find((r) => r.pageId === id);
    expect(zeile(gross)?.level).toBe("frozen");
    expect(zeile(nullen)?.level).toBe("ok");
  });

  it("zeigt Titel und Link nur fuer Seiten, die die Person sehen darf", async () => {
    const { rows } = await largestDocumentsFor(adminId, 1000);
    const zeile = (id: string) => rows.find((r) => r.pageId === id);

    expect(zeile(nullen)).toMatchObject({
      title: `${TAG}-nullen`,
      href: `/s/${TAG}-a/p/${nullen}`,
      inTrash: false,
      spaceName: `${TAG}-a`,
      bytes: 200 * KB,
    });
    // Geschuetzt ohne Freigabe, und ein Space ohne Mitgliedschaft: Groesse
    // und Space ja, Titel und Link nein.
    expect(zeile(zufall)).toMatchObject({
      title: null,
      href: null,
      spaceName: `${TAG}-a`,
    });
    expect(zeile(klein)).toMatchObject({
      title: null,
      href: null,
      spaceName: `${TAG}-b`,
      bytes: 10,
    });
    // Im Papierkorb: sichtbar, aber ohne Link.
    expect(zeile(papierkorb)).toMatchObject({
      title: `${TAG}-papierkorb`,
      href: null,
      inTrash: true,
    });
  });

  it("warnt nicht bei einem ungueltigen Wert (das tut der Collab-Server)", async () => {
    const warn = vi.spyOn(log, "warn");
    vi.stubEnv("COLLAB_MAX_DOC_MB", "abc");
    const { limits } = await largestDocumentsFor(adminId, 5);
    expect(limits.maxDocBytes).toBe(16 * 1024 * KB);
    expect(warn).not.toHaveBeenCalled();
    // Positivkontrolle: derselbe Wert mit warnendem Leser landet im Spion.
    readDocSizeLimits(process.env, (d, m) => log.warn(d, m));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
