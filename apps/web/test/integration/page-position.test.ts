import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";
import { lockSiblingOrder, nextSiblingPosition } from "@/lib/page-position";
import {
  detachLiveChildren,
  restorePageTree,
  trashPageTree,
} from "@/lib/page-guards";

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

/**
 * Die beiden Wege, auf denen eine bestehende Seite an die oberste Ebene
 * rutscht: Wiederherstellen unter einem noch geloeschten Elternteil und
 * das Abhaengen lebender Kinder vor dem endgueltigen Loeschen. Beide
 * rechneten ihr Ende der Reihe frueher selbst in SQL aus und zaehlten
 * dabei die Vorlagen mit; jetzt gilt dieselbe Regel wie beim Anlegen.
 */
describe("Ans Ende der obersten Ebene", () => {
  let raum: string;

  beforeAll(async () => {
    const space = await prisma.space.create({
      data: { slug: `${TAG}-ebene`, name: `${TAG}-ebene` },
      select: { id: true },
    });
    raum = space.id;
  });

  afterAll(async () => {
    await prisma.space.deleteMany({ where: { id: raum } });
  });

  /** Seite direkt anlegen, ohne die Positionsvergabe zu bemuehen. */
  async function seite(
    titel: string,
    position: number,
    extra: { parentId?: string; isTemplate?: boolean; deletedAt?: Date } = {},
  ) {
    const page = await prisma.page.create({
      data: {
        spaceId: raum,
        title: `${TAG}-${titel}`,
        textContent: "",
        position,
        lastEditedById: userId,
        ...extra,
      },
      select: { id: true },
    });
    return page.id;
  }

  async function lage(id: string) {
    return prisma.page.findUnique({
      where: { id },
      select: { parentId: true, position: true },
    });
  }

  beforeAll(async () => {
    // Eine Wurzelseite auf 0 und eine Vorlage weit dahinter: Vorlagen
    // liegen ebenfalls ohne Elternteil im Space, gehoeren aber nicht zur
    // Reihe der Seiten im Baum.
    await seite("wurzel", 0);
    await seite("vorlage", 40, { isTemplate: true });
  });

  it("stellt eine Seite hinter den Wurzelseiten wieder her, nicht hinter den Vorlagen", async () => {
    const eltern = await seite("eltern", 1);
    const kind = await seite("kind", 0, { parentId: eltern });
    await trashPageTree(raum, eltern);

    // Nur das Kind zurueckholen, das Elternteil bleibt im Papierkorb:
    // es muss an die oberste Ebene. Im selben Zug wie in der Action.
    await prisma.$transaction((tx) => restorePageTree(raum, kind, tx));

    // Lebende Wurzelseiten: nur "wurzel" auf 0 (das Elternteil liegt im
    // Papierkorb). Mit Vorlage gezaehlt waere es 41.
    expect(await lage(kind)).toEqual({ parentId: null, position: 1 });
  });

  it("haengt lebende Kinder hinter die Wurzelseiten, nicht hinter die Vorlagen", async () => {
    const [{ max }] = await prisma.$queryRaw<{ max: number }[]>`
      SELECT max(position)::int AS max FROM "Page"
      WHERE "spaceId" = ${raum} AND "parentId" IS NULL
        AND "deletedAt" IS NULL AND "isTemplate" = false
    `;
    const weg = await seite("weg", 5, { deletedAt: new Date() });
    const a = await seite("a", 0, { parentId: weg });
    const b = await seite("b", 1, { parentId: weg });

    const abgehaengt = await prisma.$transaction((tx) =>
      detachLiveChildren(raum, weg, tx),
    );

    expect(abgehaengt.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(await lage(a)).toEqual({ parentId: null, position: max + 1 });
    expect(await lage(b)).toEqual({ parentId: null, position: max + 2 });
    // Die Vorlage (40) liegt weit dahinter und haette sonst den Takt
    // vorgegeben.
    expect(max + 2).toBeLessThan(40);
  });

  it("nimmt beim Wiederherstellen die Reihensperre VOR jeder Zeilensperre", async () => {
    // Endgueltiges Loeschen (detachLiveChildren) nimmt zuerst die Sperre
    // der obersten Reihe und sperrt danach Zeilen im Unterbaum. Tut das
    // Wiederherstellen es umgekehrt, haelt es die Zeile und wartet auf
    // die Sperre, waehrend das Loeschen die Sperre haelt und auf die
    // Zeile wartet: Deadlock.
    //
    // Deterministisch statt auf einen Zufallstreffer gewartet: eine
    // zweite Transaktion haelt die Reihensperre, das Wiederherstellen
    // startet und muss dahinter warten, OHNE schon die Zeile des Kindes
    // gesperrt zu haben. Das zeigt sich daran, dass die zweite
    // Transaktion die Zeile danach sofort aendern kann. Mit der alten
    // Reihenfolge laeuft sie dort in den lock_timeout.
    const eltern = await seite("eltern-sperre", 3);
    const kind = await seite("kind-sperre", 0, { parentId: eltern });
    await trashPageTree(raum, eltern);

    let wiederherstellen: Promise<void> | undefined;
    await prisma.$transaction(
      async (halter) => {
        await lockSiblingOrder(halter, raum, null);
        wiederherstellen = prisma.$transaction(
          (tx) => restorePageTree(raum, kind, tx),
          { timeout: 15_000 },
        );
        // Dem Wiederherstellen Zeit geben, bis an seine erste Sperre zu
        // laufen.
        await new Promise((r) => setTimeout(r, 400));
        await halter.$executeRaw`SET LOCAL lock_timeout = '2s'`;
        await halter.$executeRaw`
          UPDATE "Page" SET title = title WHERE id = ${kind}
        `;
      },
      { timeout: 15_000 },
    );
    await wiederherstellen;
    expect(await lage(kind)).toMatchObject({ parentId: null });
  });
});
