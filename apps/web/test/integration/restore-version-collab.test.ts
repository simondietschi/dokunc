import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Redis } from "ioredis";
import pg from "pg";
import * as Y from "yjs";
import { prisma } from "@dokunc/db";
import { COLLAB_FIELD } from "@dokunc/editor";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import { SPERR_PRAEFIX } from "../../../collab/src/store-lock";

/**
 * Pruefstand: Wiederherstellen einer Version gegen einen echten
 * Collab-Server.
 *
 * Der Editor haelt den Yjs-Stand jeder Seite zusaetzlich im Browser
 * (y-indexeddb) und bringt ihn beim naechsten Oeffnen mit. Yjs vereinigt
 * dann beide Staende. Stammt der Stand des Servers aus einer NEUEN Linie
 * (Dokument aus Page.content frisch aufgebaut), kennt er die Eintraege
 * der alten Kopie nicht, kann sie also auch nicht als geloescht fuehren:
 * der alte Text stuende wieder im Dokument, neben dem wiederhergestellten.
 * Nur ein Austausch auf der BESTEHENDEN Linie (loeschen plus einfuegen)
 * gibt jeder alten Kopie die Loeschungen mit.
 *
 * Hier laufen die echte Action, der echte Collab-Server (eigener Prozess,
 * eigener Port, eigene Redis-Datenbank, siehe ./collab-pruefserver) und
 * der Provider, den auch der Editor benutzt. Die Kopie aus IndexedDB
 * spielt ein Y.Doc nach, in das der alte Stand eingespielt wird, bevor es
 * verbindet.
 *
 * Voraussetzung: kein anderer Collab-Server an demselben Redis. Pub/Sub
 * gilt in Redis ueber alle Datenbanken hinweg; ein fremder Server bekaeme
 * die Bitte um den Austausch mit und fuehrte ihn ebenfalls aus.
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
  requireUser: vi.fn(async () => mocks.actor),
  requireAdmin: vi.fn(async () => mocks.actor),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new mocks.Umleitung(url);
  }),
}));

/**
 * Eigene Redis-Datenbank fuer Nonce, Quittung, Bremsen und Sperren des
 * Pruefstands. Gesetzt vor dem ersten Redis-Zugriff der Web-App
 * (lib/redis liest REDIS_URL bei jedem Verbindungsaufbau).
 */
const REDIS_DB = 13;
const redisUrl = redisUrlMitDb(REDIS_DB);
vi.stubEnv("REDIS_URL", redisUrl);

const { restoreVersionAction } = await import("@/app/s/[slug]/actions");
const { RESTORE_STALE_PARAM } = await import("@/lib/collab-sync");
const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `rvcol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let collab: Pruefserver | null = null;
let redis: Redis;
let spaceId: string;
let sessionId: string;
const providers: HocuspocusProvider[] = [];

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** Das Dokument als Text, wie es im Yjs-Feld des Editors steht. */
function inhalt(doc: Y.Doc): string {
  return doc.getXmlFragment(COLLAB_FIELD).toString();
}

function absatz(text: string): string {
  return `<paragraph>${text}</paragraph>`;
}

/** Tippen wie im Editor: einen Absatz ans Ende setzen. */
function tippe(doc: Y.Doc, text: string): void {
  const element = new Y.XmlElement("paragraph");
  const knoten = new Y.XmlText();
  knoten.insert(0, text);
  element.insert(0, [knoten]);
  doc.getXmlFragment(COLLAB_FIELD).push([element]);
}

/**
 * Die Speichersperre der Seite vom Test aus halten, wie eine andere
 * Collab-Instanz, die gerade speichert (apps/collab/src/store-lock.ts:
 * Advisory-Sperre in Postgres). Der Speicherlauf des Pruefservers wartet
 * dann darauf; nach `ms` gibt der Test sie von selbst frei.
 */
async function halteSperre(
  pageId: string,
  ms: number,
): Promise<{ freigeben(): Promise<void> }> {
  const sperre = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await sperre.connect();
  await sperre.query("BEGIN");
  await sperre.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${SPERR_PRAEFIX}${pageId}`,
  ]);
  let frei: Promise<void> | null = null;
  const freigeben = () =>
    (frei ??= sperre
      .query("COMMIT")
      .then(() => undefined)
      .finally(() => sperre.end()));
  const timer = setTimeout(() => void freigeben(), ms);
  return {
    async freigeben() {
      clearTimeout(timer);
      await freigeben();
    },
  };
}

/** Gespeicherter Yjs-Stand der Seite, als Text. */
async function gespeichert(pageId: string): Promise<string | null> {
  const row = await prisma.collabDocument.findUnique({
    where: { pageId },
    select: { state: true },
  });
  if (!row) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.state));
  return inhalt(doc);
}

async function warteBis(
  bedingung: () => Promise<boolean> | boolean,
  was: string,
  timeoutMs = 15_000,
  takt = 100,
): Promise<void> {
  const ende = Date.now() + timeoutMs;
  while (Date.now() < ende) {
    if (await bedingung()) return;
    await new Promise((r) => setTimeout(r, takt));
  }
  throw new Error(`Zeitlimit: ${was}\n--- Collab-Log ---\n${collab?.log()}`);
}

/** Hat der Collab-Server das Dokument geladen (Kanal der HA-Erweiterung)? */
async function geladen(pageId: string): Promise<boolean> {
  const [, n] = (await redis.pubsub("NUMSUB", `hocuspocus:${pageId}`)) as [
    string,
    number,
  ];
  return Number(n) > 0;
}

/** Editor-Verbindung wie im Browser, optional mit mitgebrachtem Stand. */
async function verbinde(
  pageId: string,
  mitgebracht?: Uint8Array,
): Promise<{ doc: Y.Doc; provider: HocuspocusProvider }> {
  const doc = new Y.Doc();
  if (mitgebracht) Y.applyUpdate(doc, mitgebracht);
  let synced = false;
  const provider = new HocuspocusProvider({
    url: collab!.url,
    name: pageId,
    document: doc,
    token: () =>
      issueCollabTicket({
        userId: mocks.actor!.id,
        tokenVersion: 0,
        sessionId,
        pageId,
      }),
    onSynced: () => {
      synced = true;
    },
  });
  providers.push(provider);
  await warteBis(() => synced, "Editor synchronisiert");
  return { doc, provider };
}

async function neueSeite(text: string): Promise<string> {
  return (
    await prisma.page.create({
      data: {
        spaceId,
        title: `${TAG}-seite`,
        content: { type: "doc", content: [paragraph(text)] },
        textContent: text,
      },
      select: { id: true },
    })
  ).id;
}

async function neueVersion(pageId: string, text: string): Promise<string> {
  return (
    await prisma.pageVersion.create({
      data: {
        pageId,
        title: `${TAG}-version`,
        content: { type: "doc", content: [paragraph(text)] },
        textContent: text,
      },
      select: { id: true },
    })
  ).id;
}

async function wiederherstellen(versionId: string): Promise<string> {
  const form = new FormData();
  form.set("slug", TAG);
  form.set("versionId", versionId);
  try {
    await restoreVersionAction(form);
  } catch (e) {
    if (e instanceof mocks.Umleitung) return e.url;
    throw e;
  }
  throw new Error("restoreVersionAction hat nicht umgeleitet");
}

beforeAll(async () => {
  collab = await startePruefserver({
    redisDb: REDIS_DB,
    // Dasselbe Secret, mit dem die Web-App hier die Tickets signiert.
    appSecret: getAppSecret(),
    exklusiv: true,
  });
  redis = collab.redis;

  const owner = await prisma.user.create({
    data: { email: `${TAG}-owner@example.test`, name: "Owner", passwordHash: "x" },
    select: { id: true, email: true, name: true },
  });
  mocks.actor = { ...owner, isAdmin: false };
  sessionId = (
    await prisma.session.create({
      data: { userId: owner.id, expiresAt: new Date(Date.now() + 3_600_000) },
      select: { id: true },
    })
  ).id;
  spaceId = (
    await prisma.space.create({
      data: {
        name: TAG,
        slug: TAG,
        members: { create: [{ userId: owner.id, role: "OWNER" }] },
      },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  for (const p of providers) p.destroy();
  await collab?.stop();
  vi.unstubAllEnvs();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe("Wiederherstellen gegen einen echten Collab-Server", () => {
  // Der haeufigste Ablauf: im Editor schreiben, zum Verlauf wechseln (das
  // Dokument wird entladen), Version wiederherstellen, Seite wieder
  // oeffnen — der Browser bringt seinen alten Stand aus IndexedDB mit.
  it("laesst den alten Text nicht zurueckkehren, wenn keine Instanz das Dokument hielt", async () => {
    const pageId = await neueSeite("Alpha");
    const a = await verbinde(pageId);
    expect(inhalt(a.doc)).toBe(absatz("Alpha"));

    tippe(a.doc, "Zweiter Stand");
    await warteBis(
      async () =>
        (await gespeichert(pageId)) === absatz("Alpha") + absatz("Zweiter Stand"),
      "zweiter Stand gespeichert",
    );

    // Wie y-indexeddb: der Stand bleibt im Browser, der Tab geht zu.
    const imBrowser = Y.encodeStateAsUpdate(a.doc);
    a.provider.destroy();
    await warteBis(async () => !(await geladen(pageId)), "Dokument entladen");

    const versionId = await neueVersion(pageId, "Wiederhergestellt");
    const ziel = await wiederherstellen(versionId);
    // Bestaetigt: kein Hinweis.
    expect(ziel).toBe(`/s/${TAG}/p/${pageId}`);
    expect(ziel).not.toContain(RESTORE_STALE_PARAM);
    // Quittiert wird erst, wenn der neue Stand gespeichert ist.
    expect(await gespeichert(pageId)).toBe(absatz("Wiederhergestellt"));

    const b = await verbinde(pageId, imBrowser);
    expect(inhalt(b.doc)).toBe(absatz("Wiederhergestellt"));

    // Auch der Server hat nichts vom alten Stand zurueckbekommen.
    b.provider.destroy();
    await warteBis(async () => !(await geladen(pageId)), "Dokument entladen");
    expect(await gespeichert(pageId)).toBe(absatz("Wiederhergestellt"));
    const page = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { textContent: true },
    });
    expect(page.textContent).toBe("Wiederhergestellt");
  }, 60_000);

  // Ein zweiter Tab ist offen: er uebernimmt den Stand live, und eine
  // alte Kopie, die spaeter verbindet, bringt ebenfalls nichts zurueck.
  it("tauscht bei geoeffnetem Editor live aus und speichert vor der Quittung", async () => {
    const pageId = await neueSeite("Alpha");
    const offen = await verbinde(pageId);
    const vorher = Y.encodeStateAsUpdate(offen.doc);

    const versionId = await neueVersion(pageId, "Wiederhergestellt");
    const ziel = await wiederherstellen(versionId);
    expect(ziel).toBe(`/s/${TAG}/p/${pageId}`);
    expect(await gespeichert(pageId)).toBe(absatz("Wiederhergestellt"));
    await warteBis(
      () => inhalt(offen.doc) === absatz("Wiederhergestellt"),
      "offener Editor uebernimmt den Stand",
    );

    const alt = await verbinde(pageId, vorher);
    expect(inhalt(alt.doc)).toBe(absatz("Wiederhergestellt"));
    expect(inhalt(offen.doc)).toBe(absatz("Wiederhergestellt"));

    // Der Speicherlauf nach dem Austausch nennt die Person, die
    // wiederhergestellt hat — sonst stuende dort niemand ("System"). Hier
    // ist er der einzige: der offene Editor hat nichts geschrieben.
    await warteBis(async () => {
      const page = await prisma.page.findUniqueOrThrow({
        where: { id: pageId },
        select: { lastEditedById: true },
      });
      return page.lastEditedById === mocks.actor!.id;
    }, "Person als Bearbeiter eingetragen");
    // Die Version dieses Laufs entsteht zuletzt, nach Page.content.
    const snapshot = () =>
      prisma.pageVersion.findFirst({
        where: { pageId, NOT: { id: versionId } },
        select: { authorId: true, textContent: true },
      });
    await warteBis(async () => (await snapshot()) !== null, "Version angelegt");
    expect(await snapshot()).toEqual({
      authorId: mocks.actor!.id,
      textContent: "Wiederhergestellt",
    });
  }, 60_000);

  // Quittiert wird erst, wenn der ausgetauschte Stand gespeichert ist.
  // Hier kann der Collab-Server nicht speichern, solange die Action
  // wartet: die Speichersperre der Seite haelt der Test, wie eine andere
  // Instanz, die gerade speichert. Eine Quittung schon nach dem Austausch
  // im Speicher meldete Erfolg fuer einen Stand, den der naechste Start
  // nicht mehr kennt.
  it("meldet keinen Erfolg, solange der ausgetauschte Stand nicht gespeichert ist", async () => {
    const pageId = await neueSeite("Alpha");
    const a = await verbinde(pageId);
    a.provider.destroy();
    await warteBis(async () => !(await geladen(pageId)), "Dokument entladen");
    expect(await gespeichert(pageId)).toBe(absatz("Alpha"));

    const sperre = await halteSperre(pageId, 15_000);
    try {
      const versionId = await neueVersion(pageId, "Wiederhergestellt");
      const ziel = await wiederherstellen(versionId);
      expect(ziel).toBe(`/s/${TAG}/p/${pageId}?${RESTORE_STALE_PARAM}=${versionId}`);
      // Rueckfall der Action: der naechste Start baut aus Page.content.
      expect(await gespeichert(pageId)).toBeNull();
    } finally {
      await sperre.freigeben();
    }
    // Der Speicherlauf hat auf die Sperre gewartet, statt verworfen zu
    // werden: danach steht die Wiederherstellung auf derselben Linie in
    // CollabDocument.
    await warteBis(
      async () => (await gespeichert(pageId)) === absatz("Wiederhergestellt"),
      "Wiederherstellung nach der Sperre gespeichert",
    );
  }, 60_000);

  // Haelt eine andere Instanz gerade die Speichersperre der Seite, wartet
  // der Speicherlauf nach dem Austausch darauf und speichert dann. Frueher
  // (Sperre in Redis) wurde er verworfen, und Hocuspocus entlud das
  // Dokument ungespeichert; ein danach neu geladenes Dokument kannte den
  // Austausch nicht. Diesen Weg gibt es nicht mehr: das Dokument bleibt,
  // bis sein Stand gespeichert ist, und die Action meldet Erfolg.
  it("wartet auf die Speichersperre einer anderen Instanz und quittiert dann", async () => {
    const pageId = await neueSeite("Alpha");
    const a = await verbinde(pageId);
    a.provider.destroy();
    await warteBis(async () => !(await geladen(pageId)), "Dokument entladen");
    expect(await gespeichert(pageId)).toBe(absatz("Alpha"));
    const versionId = await neueVersion(pageId, "Wiederhergestellt");
    const logAb = collab!.log().length;

    const sperre = await halteSperre(pageId, 1_300);
    let ziel: string;
    try {
      ziel = await wiederherstellen(versionId);
    } finally {
      await sperre.freigeben();
    }

    expect(ziel).toBe(`/s/${TAG}/p/${pageId}`);
    expect(await gespeichert(pageId)).toBe(absatz("Wiederhergestellt"));
    const b = await verbinde(pageId);
    expect(inhalt(b.doc)).toBe(absatz("Wiederhergestellt"));
    expect(collab!.log().slice(logAb)).not.toContain(
      "Dokument entladen, bevor der Stand gespeichert war",
    );
  }, 60_000);

  // Ein Editor hat den Austausch gesehen und die Seite verlassen, bevor
  // gespeichert werden konnte. Seine Kopie im Browser traegt die Eintraege
  // dieses Austauschs. Wurde das Dokument dabei ungespeichert entladen
  // (frueher, als die Sperre in Redis den Speicherlauf verwarf), tauschte
  // die Wiederholung in einem neu geladenen Dokument aus und musste den
  // Stand des entladenen mitnehmen, sonst stuende der wiederhergestellte
  // Absatz beim naechsten Oeffnen doppelt da. Heute wartet der Lauf auf
  // die Sperre; verdoppelt werden darf trotzdem nichts.
  it("verdoppelt nichts, wenn ein Editor den ungespeicherten Austausch gesehen hat", async () => {
    const pageId = await neueSeite("Alpha");
    const vorab = await verbinde(pageId);
    vorab.provider.destroy();
    await warteBis(async () => !(await geladen(pageId)), "Dokument entladen");
    const versionId = await neueVersion(pageId, "Wiederhergestellt");

    const a = await verbinde(pageId);
    const logAb = collab!.log().length;
    const sperre = await halteSperre(pageId, 1_300);
    let ziel: string;
    let imBrowser: Uint8Array;
    try {
      const action = wiederherstellen(versionId);
      action.catch(() => undefined);
      await warteBis(
        () => inhalt(a.doc) === absatz("Wiederhergestellt"),
        "Editor sieht den Austausch",
        5_000,
        5,
      );
      // Wie y-indexeddb: der Stand bleibt im Browser, der Tab geht zu,
      // solange der Speicherlauf noch auf die Sperre wartet.
      imBrowser = Y.encodeStateAsUpdate(a.doc);
      a.provider.destroy();
      ziel = await action;
    } finally {
      await sperre.freigeben();
    }

    if (!ziel.includes(RESTORE_STALE_PARAM)) {
      expect(ziel).toBe(`/s/${TAG}/p/${pageId}`);
      expect(await gespeichert(pageId)).toBe(absatz("Wiederhergestellt"));
      const wieder = await verbinde(pageId, imBrowser);
      expect(inhalt(wieder.doc)).toBe(absatz("Wiederhergestellt"));
    } else {
      expect(ziel).toBe(`/s/${TAG}/p/${pageId}?${RESTORE_STALE_PARAM}=${versionId}`);
    }
    // Das Dokument mit dem Austausch wurde nicht ungespeichert entladen:
    // sein Speicherlauf hat auf die Sperre gewartet.
    expect(collab!.log().slice(logAb)).not.toContain(
      "Dokument entladen, bevor der Stand gespeichert war",
    );
  }, 60_000);
});
