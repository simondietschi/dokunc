import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Redis } from "ioredis";
import * as Y from "yjs";
import { currentRestoreEpoch, prisma, readInstanceState } from "@dokunc/db";
import {
  COLLAB_FIELD,
  SCHEMA_ANNOUNCE_CHANNEL,
  editorSchema,
} from "@dokunc/editor";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import { inhalt, tippe, verbinde, warteBis } from "./collab-hilfen";

/**
 * Speichern mit mehreren Collab-Instanzen: der Speicherlauf fuehrt den
 * Stand, den eine andere Instanz inzwischen gespeichert hat, mit dem
 * eigenen zusammen, statt ihn zu ueberschreiben.
 *
 * Die andere Instanz stellt der Test nach, indem er CollabDocument selbst
 * schreibt (so wie ein Speicherlauf dort: der ganze Yjs-Stand, neues
 * updatedAt). Das braucht keinen zweiten Redis und keine zweite Instanz;
 * den Fall mit zwei echten Instanzen, die sich nicht ueber Redis
 * abgleichen, prueft collab-chaos.test.ts.
 *
 * Echter Collab-Server (eigener Prozess, Redis-Datenbank 3, siehe
 * ./collab-pruefserver). Die Faelle, nach denen die Instanz keine
 * Editoren mehr annimmt, starten je einen eigenen.
 */

const REDIS_DB = 3;
const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let collab: Pruefserver | null = null;
let providers: HocuspocusProvider[] = [];
let userId: string;
let sessionId: string;
let spaceId: string;
let epoche: string | null;

async function neueSeite(titel: string): Promise<string> {
  return (
    await prisma.page.create({
      data: {
        spaceId,
        title: `${TAG}-${titel}`,
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Start" }] },
          ],
        },
        textContent: "Start",
      },
      select: { id: true },
    })
  ).id;
}

async function oeffne(server: Pruefserver, pageId: string) {
  let geschlossen = false;
  const v = await verbinde({
    url: server.url,
    pageId,
    ticket: () =>
      issueCollabTicket({
        userId,
        tokenVersion: 0,
        sessionId,
        pageId,
        restoreEpoch: epoche,
      }),
    onClose: () => {
      geschlossen = true;
    },
  });
  providers.push(v.provider);
  return { ...v, geschlossen: () => geschlossen };
}

async function zeile(pageId: string) {
  return prisma.collabDocument.findUnique({
    where: { pageId },
    select: { state: true, updatedAt: true },
  });
}

/** Gespeicherter Yjs-Stand als Text; "" ohne Zeile oder bei unlesbarem Stand. */
async function yjsText(pageId: string): Promise<string> {
  const z = await zeile(pageId);
  if (!z) return "";
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(z.state));
  } catch {
    return "";
  }
  return inhalt(doc);
}

async function seitenInhalt(pageId: string): Promise<string> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { content: true },
  });
  return JSON.stringify(page?.content ?? null);
}

/**
 * Wie der Speicherlauf einer anderen Instanz: gespeicherten Stand lesen,
 * `aendere` darauf anwenden, den ganzen Stand zurueckschreiben.
 */
async function andereInstanzSpeichert(
  pageId: string,
  aendere: (doc: Y.Doc) => void,
): Promise<Buffer> {
  const z = await zeile(pageId);
  if (!z) throw new Error("Noch kein gespeicherter Stand");
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(z.state));
  aendere(doc);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  await prisma.collabDocument.update({ where: { pageId }, data: { state } });
  return state;
}

beforeAll(async () => {
  collab = await startePruefserver({
    redisDb: REDIS_DB,
    appSecret: getAppSecret(),
    exklusiv: true,
  });
  epoche = await currentRestoreEpoch(prisma);
  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: "Merge", passwordHash: "x" },
    select: { id: true },
  });
  userId = user.id;
  sessionId = (
    await prisma.session.create({
      data: { userId, expiresAt: new Date(Date.now() + 3_600_000) },
      select: { id: true },
    })
  ).id;
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug: TAG,
        members: { create: [{ userId, role: "OWNER" }] },
      },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterEach(() => {
  for (const p of providers) p.destroy();
  providers = [];
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await collab?.stop();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe("Speichern mit dem Stand anderer Instanzen", () => {
  it("fuehrt den gespeicherten Stand einer anderen Instanz mit dem eigenen zusammen", async () => {
    const pageId = await neueSeite("zusammen");
    const a = await oeffne(collab!, pageId);
    await warteBis(async () => !!(await zeile(pageId)), "Zeile angelegt");

    await andereInstanzSpeichert(pageId, (doc) => tippe(doc, "Fremd-1"));
    tippe(a.doc, "Eigen-1");

    await warteBis(
      async () => (await yjsText(pageId)).includes("Eigen-1"),
      "Eigen-1 gespeichert",
      { log: collab!.log },
    );
    const gespeichert = await yjsText(pageId);
    expect(gespeichert).toContain("Fremd-1");
    expect(gespeichert).toContain("Start");
    await warteBis(
      async () => (await seitenInhalt(pageId)).includes("Eigen-1"),
      "Eigen-1 in Page.content",
    );
    expect(await seitenInhalt(pageId)).toContain("Fremd-1");
    // Der offene Editor dieser Instanz bekommt den fremden Absatz auch.
    await warteBis(
      () => inhalt(a.doc).includes("Fremd-1"),
      "Fremd-1 im Editor",
    );
  });

  // Heute ueberschreibt der naechste Lauf eine kaputte Zeile; so bleibt
  // es. Wuerfe der Lauf, scheiterte jeder weitere auch, und die Seite
  // bliebe bis zum Neustart ungespeichert.
  it("schreibt ueber einen unlesbaren gespeicherten Stand den eigenen", async () => {
    const pageId = await neueSeite("unlesbar");
    const a = await oeffne(collab!, pageId);
    await warteBis(async () => !!(await zeile(pageId)), "Zeile angelegt");

    await prisma.collabDocument.update({
      where: { pageId },
      data: { state: Buffer.from([255, 255, 255]) },
    });
    tippe(a.doc, "Eigen-3");

    await warteBis(
      async () => (await yjsText(pageId)).includes("Eigen-3"),
      "Eigen-3 gespeichert",
      { log: collab!.log },
    );
    expect(await yjsText(pageId)).toContain("Start");
    expect(collab!.log()).toContain(
      "Gespeicherter Stand nicht lesbar, ohne Zusammenfuehren gespeichert",
    );
  });
});

describe("Speichern mit dem Stand anderer Instanzen, danach ohne Editoren", () => {
  let server: Pruefserver | null = null;
  let markeVorher: { version: number; hash: string | null } | null = null;

  afterEach(async () => {
    for (const p of providers) p.destroy();
    providers = [];
    await server?.stop();
    server = null;
    if (markeVorher) {
      await prisma.$executeRaw`UPDATE "InstanceState" SET "editorSchemaVersion" = ${markeVorher.version}, "editorSchemaHash" = ${markeVorher.hash} WHERE "id" = 1`;
      markeVorher = null;
    }
  }, 30_000);

  // Eine neuere Fassung hat Knoten gespeichert, die diese nicht kennt.
  // Zusammengefuehrt landeten sie im Dokument, und ein Editor dieser
  // Fassung loeschte sie beim naechsten Anzeigen fuer alle.
  it("fuehrt einen Stand ausserhalb des eigenen Editor-Schemas nicht zusammen und nimmt keine Editoren mehr an", async () => {
    server = await startePruefserver({
      redisDb: REDIS_DB,
      appSecret: getAppSecret(),
    });
    const pageId = await neueSeite("fremdes-schema");
    const a = await oeffne(server, pageId);
    await warteBis(async () => !!(await zeile(pageId)), "Zeile angelegt");

    const fremd = await andereInstanzSpeichert(pageId, (doc) => {
      const knoten = new Y.XmlElement("zauberknoten");
      const text = new Y.XmlText();
      text.insert(0, "Hokuspokus");
      knoten.insert(0, [text]);
      doc.getXmlFragment(COLLAB_FIELD).push([knoten]);
    });
    tippe(a.doc, "Eigen-2");

    await warteBis(
      () =>
        server!
          .log()
          .includes(
            "Gespeicherter Stand ausserhalb des Editor-Schemas: nicht zusammengefuehrt",
          ),
      "Fehlerzeile zum fremden Schema",
      { log: server.log },
    );
    expect(server.log()).toContain('"unknownNodes":["zauberknoten"]');
    await warteBis(() => a.geschlossen(), "Editor getrennt", {
      log: server.log,
    });
    expect(inhalt(a.doc)).not.toContain("Hokuspokus");
    // Nichts ueberschrieben: die Zeile traegt den Stand der anderen Instanz.
    expect(Buffer.compare((await zeile(pageId))!.state, fremd)).toBe(0);
  }, 60_000);

  // Eine veraltete Instanz hat keine Editoren mehr, kann aber noch einen
  // ausstehenden Speicherlauf haben. Sie fuehrt nie zusammen und
  // ueberschreibt nicht, was eine andere Instanz gespeichert hat.
  it("laesst eine veraltete Instanz den Stand einer anderen weder zusammenfuehren noch ueberschreiben", async () => {
    const z = await readInstanceState(prisma);
    markeVorher = { version: z.editorSchemaVersion, hash: z.editorSchemaHash };
    server = await startePruefserver({
      redisDb: REDIS_DB,
      appSecret: getAppSecret(),
    });
    const pageId = await neueSeite("veraltet");
    const a = await oeffne(server, pageId);
    await warteBis(async () => !!(await zeile(pageId)), "Zeile angelegt");

    // Tippen: der Speicherlauf steht zwei Sekunden aus. In dieser Zeit
    // speichert eine neuere Instanz und kuendigt sich an.
    tippe(a.doc, "Eigen-4");
    const fremd = await andereInstanzSpeichert(pageId, (doc) =>
      tippe(doc, "Fremd-4"),
    );
    const neuer = {
      version: editorSchema().version + 1,
      hash: "ffffffffffffffff",
    };
    await prisma.$executeRaw`UPDATE "InstanceState" SET "editorSchemaVersion" = ${neuer.version}, "editorSchemaHash" = ${neuer.hash} WHERE "id" = 1`;
    const sender = new Redis(redisUrlMitDb(REDIS_DB), {
      maxRetriesPerRequest: 1,
    });
    try {
      await sender.publish(
        SCHEMA_ANNOUNCE_CHANNEL,
        JSON.stringify({ instanceId: `${TAG}-neuer`, ...neuer }),
      );
    } finally {
      sender.disconnect();
    }
    // Das Trennen stoesst den ausstehenden Lauf sofort an.
    await warteBis(() => a.geschlossen(), "Editor getrennt", {
      log: server.log,
    });
    await warteBis(
      () => server!.log().includes("Speicherlauf gescheitert"),
      "Lauf der veralteten Instanz",
      { log: server.log },
    );
    expect(Buffer.compare((await zeile(pageId))!.state, fremd)).toBe(0);
    expect(await yjsText(pageId)).not.toContain("Eigen-4");
  }, 60_000);
});
