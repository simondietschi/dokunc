import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";
import { nextSiblingPosition } from "@/lib/page-position";

/**
 * Positionsvergabe unter Gleichzeitigkeit.
 *
 * Der Befund war: vier Stellen lasen erst das Maximum der Geschwister
 * und schrieben danach Maximum+1. Zwei gleichzeitige Anlagen unter
 * derselben Elternseite lesen dabei dasselbe Maximum und vergeben
 * dieselbe Zahl.
 *
 * Das laesst sich nur gegen eine echte Datenbank pruefen: die Abhilfe
 * ist eine Postgres-Sperre (`pg_advisory_xact_lock`), und ein Mock
 * wuerde genau das nachbauen, was zu pruefen ist. Der Test laesst die
 * beiden Transaktionen deshalb wirklich gleichzeitig laufen und legt
 * zwischen Lesen und Schreiben eine Pause ein — ohne Sperre kollidieren
 * sie damit zuverlaessig.
 */

const TAG = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let spaceId: string;
let userId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: TAG, passwordHash: "x" },
    select: { id: true },
  });
  userId = user.id;
  const space = await prisma.space.create({
    data: { slug: TAG, name: TAG },
    select: { id: true },
  });
  spaceId = space.id;
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

/** Legt eine Seite an wie die Aktionen es tun: Position, Pause, Insert. */
async function legeAn(titel: string, parentId: string | null) {
  return prisma.$transaction(async (tx) => {
    const position = await nextSiblingPosition(tx, spaceId, parentId);
    // Ohne diese Pause gewinnt die Serialisierung womoeglich zufaellig,
    // weil beide Transaktionen ohnehin nacheinander durchlaufen.
    await new Promise((r) => setTimeout(r, 120));
    return tx.page.create({
      data: {
        spaceId,
        parentId,
        title: titel,
        textContent: "",
        position,
        lastEditedById: userId,
      },
      select: { id: true, position: true },
    });
  });
}

describe("nextSiblingPosition()", () => {
  it("beginnt bei 0 und zaehlt hoch", async () => {
    const a = await legeAn(`${TAG}-a`, null);
    const b = await legeAn(`${TAG}-b`, null);
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
  });

  it("vergibt bei gleichzeitigen Anlagen keine Position zweimal", async () => {
    const parent = await prisma.page.create({
      data: {
        spaceId,
        title: `${TAG}-eltern`,
        textContent: "",
        position: 99,
        lastEditedById: userId,
      },
      select: { id: true },
    });

    const ergebnisse = await Promise.all([
      legeAn(`${TAG}-p1`, parent.id),
      legeAn(`${TAG}-p2`, parent.id),
      legeAn(`${TAG}-p3`, parent.id),
    ]);

    const positionen = ergebnisse.map((e) => e.position).sort((x, y) => x - y);
    expect(positionen).toEqual([0, 1, 2]);
  });

  it("sperrt nur die eigene Geschwisterreihe", async () => {
    // Zwei verschiedene Elternseiten duerfen sich nicht gegenseitig
    // aufhalten — sonst waere die Sperre eine Space-weite Bremse.
    const [e1, e2] = await Promise.all([
      prisma.page.create({
        data: {
          spaceId,
          title: `${TAG}-e1`,
          textContent: "",
          position: 50,
          lastEditedById: userId,
        },
        select: { id: true },
      }),
      prisma.page.create({
        data: {
          spaceId,
          title: `${TAG}-e2`,
          textContent: "",
          position: 51,
          lastEditedById: userId,
        },
        select: { id: true },
      }),
    ]);

    const start = Date.now();
    const ergebnisse = await Promise.all([
      legeAn(`${TAG}-k1`, e1.id),
      legeAn(`${TAG}-k2`, e2.id),
    ]);
    // Beide Pausen (je 120 ms) laufen parallel, nicht nacheinander.
    expect(Date.now() - start).toBeLessThan(240);
    expect(ergebnisse.map((e) => e.position)).toEqual([0, 0]);
  });

  it("zaehlt Vorlagen und geloeschte Seiten nicht mit", async () => {
    await prisma.page.create({
      data: {
        spaceId,
        title: `${TAG}-vorlage`,
        textContent: "",
        position: 7,
        isTemplate: true,
        lastEditedById: userId,
      },
    });
    const eltern = await prisma.page.create({
      data: {
        spaceId,
        title: `${TAG}-e3`,
        textContent: "",
        position: 60,
        lastEditedById: userId,
      },
      select: { id: true },
    });
    await prisma.page.create({
      data: {
        spaceId,
        parentId: eltern.id,
        title: `${TAG}-weg`,
        textContent: "",
        position: 5,
        deletedAt: new Date(),
        lastEditedById: userId,
      },
    });

    const frisch = await prisma.$transaction((tx) =>
      nextSiblingPosition(tx, spaceId, eltern.id),
    );
    expect(frisch).toBe(0);
  });
});
