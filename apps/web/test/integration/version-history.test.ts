import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Verlauf mit Cursor: Blaettern ueber die ganze Liste, auch ueber
 * Versionen mit gleicher Zeit an der Seitengrenze, und mit einem Cursor,
 * dessen Version inzwischen ausgeduennt ist.
 */

const { loadVersionPage, parseHistoryCursor } = await import(
  "@/lib/version-history"
);

const TAG = `vhist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let spaceId: string;
let pageId: string;
/** Alle ids, neueste zuerst, wie der Verlauf sie zeigen muss. */
const erwartet: string[] = [];

beforeAll(async () => {
  spaceId = (
    await prisma.space.create({
      data: { name: TAG, slug: TAG },
      select: { id: true },
    })
  ).id;
  pageId = (
    await prisma.page.create({
      data: { spaceId, title: TAG },
      select: { id: true },
    })
  ).id;
  // 130 Versionen, neueste zuerst gezaehlt; die Positionen 15 bis 34
  // haben dieselbe Zeit und liegen damit ueber der Seitengrenze bei 25.
  const t0 = new Date("2026-01-01T00:00:00Z").getTime();
  const gleich = new Date(t0 + 1_000_000 * 60_000);
  const rows = [];
  for (let pos = 0; pos < 130; pos++) {
    const id = `${TAG}-${String(1000 - pos).padStart(4, "0")}`;
    const createdAt =
      pos >= 15 && pos <= 34
        ? gleich
        : new Date(t0 + (1_000_000 + (pos < 15 ? 100 - pos : -pos)) * 60_000);
    rows.push({ id, pageId, title: TAG, createdAt });
    erwartet.push(id);
  }
  // In zufaelliger Reihenfolge anlegen: die Einfuegereihenfolge darf keine
  // Rolle spielen.
  rows.sort(() => Math.random() - 0.5);
  await prisma.pageVersion.createMany({ data: rows });
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
});

async function alleSeiten(): Promise<string[][]> {
  const seiten: string[][] = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const { versions, next } = await loadVersionPage(pageId, cursor, 25);
    seiten.push(versions.map((v) => v.id));
    if (!next) break;
    cursor = parseHistoryCursor(next);
    expect(cursor).not.toBeNull();
  }
  return seiten;
}

describe("loadVersionPage", () => {
  it("liefert alle 130 Versionen genau einmal, neueste zuerst", async () => {
    const seiten = await alleSeiten();
    expect(seiten.map((s) => s.length)).toEqual([25, 25, 25, 25, 25, 5]);
    expect(seiten.flat()).toEqual(erwartet);
  });

  it("blaettert auch weiter, wenn die Version des Cursors inzwischen geloescht ist", async () => {
    const erste = await loadVersionPage(pageId, null, 25);
    const next = erste.next!;
    const letzte = erste.versions[24].id;
    // Die letzte angezeigte Version (mitten in den gleichen Zeiten) wird
    // ausgeduennt, bevor jemand weiterblaettert.
    await prisma.pageVersion.delete({ where: { id: letzte } });
    const zweite = await loadVersionPage(pageId, parseHistoryCursor(next), 25);
    expect(zweite.versions.map((v) => v.id)).toEqual(erwartet.slice(25, 50));
  });
});
