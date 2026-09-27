import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { currentRestoreEpoch, prisma } from "@dokunc/db";
import { parseDocSizeNotice, type DocSizeNotice } from "@dokunc/editor";
import {
  statusHandlers,
  type EditorStatus,
  type SetEditorStatus,
} from "@/lib/editor-status";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import { inhalt, tippe, verbinde, warteBis } from "./collab-hilfen";

/**
 * Pruefstand: Groessengrenzen des Collab-Servers (COLLAB_MAX_DOC_MB,
 * COLLAB_MAX_MESSAGE_MB) gegen einen echten Server.
 *
 * Mit COLLAB_MAX_DOC_MB=1 gelten: Dokumentgrenze 1 MiB, Warnschwelle
 * 512 KiB, Nachrichtengrenze 2 MiB. Echter Server (eigener Prozess,
 * Redis-Datenbank 10, siehe ./collab-pruefserver), echte Provider, echte
 * Datenbank, echte Wiederherstellung (restoreVersionAction).
 *
 * Grosse Inhalte sind je ein Absatz "x".repeat(n); ihr Yjs-Stand ist
 * etwas groesser als n Bytes.
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

const REDIS_DB = 10;
vi.stubEnv("REDIS_URL", redisUrlMitDb(REDIS_DB));

const { restoreVersionAction } = await import("@/app/s/[slug]/actions");
const { RESTORE_STALE_PARAM } = await import("@/lib/collab-sync");
const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `csl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KiB = 1024;
const MiB = 1024 * KiB;

let collab: Pruefserver | null = null;
let spaceId: string;
let userId: string;
let sessionId: string;
let epoch: string | null = null;
/** 1.5 MB gespeichert: Bestand ueber der Grenze. */
let bestand: string;
/** 2.5 MB gespeichert: ueber der Nachrichtengrenze. */
let gross: string;
let grossState: Uint8Array;
/** 1.5 MB gespeichert, fuer den Neustart mit hoeherer Grenze. */
let neustart: string;
/** Provider des laufenden Falls, in afterEach geschlossen. */
let offen: HocuspocusProvider[] = [];

const log = () => collab?.log() ?? "";

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

/** Yjs-Stand mit einem Absatz. */
function kodiert(text: string): Uint8Array {
  const doc = new Y.Doc();
  tippe(doc, text);
  return Y.encodeStateAsUpdate(doc);
}

async function neueSeite(
  name: string,
  state?: Uint8Array,
): Promise<string> {
  const id = (
    await prisma.page.create({
      data: {
        spaceId,
        title: `${TAG}-${name}`,
        content: { type: "doc", content: [paragraph("Start")] },
        textContent: "Start",
      },
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

/** Gespeicherter Yjs-Stand: Text und Groesse. */
async function gespeichert(
  pageId: string,
): Promise<{ text: string; bytes: number } | null> {
  const row = await prisma.collabDocument.findUnique({
    where: { pageId },
    select: { state: true },
  });
  if (!row) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.state));
  return { text: inhalt(doc), bytes: row.state.byteLength };
}

type Beobachtet = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  hinweise: DocSizeNotice[];
  closes: (number | undefined)[];
  /** Zuletzt gemeldete Stufe. */
  stufe(): DocSizeNotice["level"] | undefined;
};

async function oeffne(
  pageId: string,
  opts: {
    mitgebracht?: Uint8Array;
    warteAufSync?: boolean;
    onClose?: (code: number | undefined) => void;
    extra?: Parameters<typeof verbinde>[0]["extra"];
  } = {},
): Promise<Beobachtet> {
  const hinweise: DocSizeNotice[] = [];
  const closes: (number | undefined)[] = [];
  const { doc, provider } = await verbinde({
    url: collab!.url,
    pageId,
    ticket: () =>
      issueCollabTicket({
        userId,
        tokenVersion: 0,
        sessionId,
        pageId,
        restoreEpoch: epoch,
      }),
    mitgebracht: opts.mitgebracht,
    warteAufSync: opts.warteAufSync,
    timeoutMs: 30_000,
    onStateless: (payload) => {
      const n = parseDocSizeNotice(payload);
      if (n) hinweise.push(n);
    },
    onClose: (code) => {
      closes.push(code);
      opts.onClose?.(code);
    },
    extra: opts.extra,
  });
  offen.push(provider);
  return {
    doc,
    provider,
    hinweise,
    closes,
    stufe: () => hinweise.at(-1)?.level,
  };
}

/** Logzeilen des Servers mit dieser Meldung und Seite. */
function logZeilen(msg: string, pageId?: string): Record<string, unknown>[] {
  return log()
    .split("\n")
    .filter((z) => z.startsWith("{"))
    .map((z) => {
      try {
        return JSON.parse(z) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter(
      (z) =>
        typeof z.msg === "string" &&
        z.msg.includes(msg) &&
        (pageId === undefined || z.pageId === pageId),
    );
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  epoch = await currentRestoreEpoch(prisma);
  const owner = await prisma.user.create({
    data: {
      email: `${TAG}-owner@example.test`,
      name: "Owner",
      passwordHash: "x",
    },
    select: { id: true, email: true, name: true },
  });
  userId = owner.id;
  mocks.actor = { ...owner, isAdmin: false };
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

  // Vor dem Start des Servers: der Startcheck soll sie zaehlen.
  bestand = await neueSeite("bestand", kodiert("b".repeat(1.5 * MiB)));
  grossState = kodiert("g".repeat(2.5 * MiB));
  gross = await neueSeite("gross", grossState);
  neustart = await neueSeite("neustart", kodiert("n".repeat(1.5 * MiB)));

  collab = await startePruefserver({
    redisDb: REDIS_DB,
    appSecret: getAppSecret(),
    exklusiv: true,
    env: { COLLAB_MAX_DOC_MB: "1" },
  });
}, 60_000);

afterEach(() => {
  for (const p of offen) p.destroy();
  offen = [];
});

afterAll(async () => {
  for (const p of offen) p.destroy();
  await collab?.stop();
  vi.unstubAllEnvs();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe("Groessengrenzen des Collab-Servers", () => {
  it("T1 nennt beim Start die Zahl der Dokumente ueber der Grenze", async () => {
    await warteBis(
      () =>
        logZeilen("Collab-Dokumente ueber der Groessengrenze").length > 0,
      "Startlog der Groessenpruefung",
      { log },
    );
    const [zeile] = logZeilen("Collab-Dokumente ueber der Groessengrenze");
    expect(Number(zeile!.anzahl)).toBeGreaterThanOrEqual(2);
    expect(zeile!.grenze).toBe(MiB);
    const [grenzen] = logZeilen("Groessengrenzen");
    expect(grenzen).toMatchObject({
      dokumentGrenze: MiB,
      warnschwelle: 512 * KiB,
      nachrichtenGrenze: 2 * MiB,
    });
  });

  it("T2 schliesst eine zu grosse Nachricht mit 1009, der Editor trennt endgueltig", async () => {
    const pageId = await neueSeite("nachricht");
    let status: EditorStatus = "connecting";
    const setStatus: SetEditorStatus = (next) => {
      status = typeof next === "function" ? next(status) : next;
    };
    const ref: { a?: Beobachtet } = {};
    // Wie im Editor: nach 1009 endgueltig trennen.
    const h = statusHandlers(setStatus, {
      onMessageTooLarge: () => ref.a?.provider.disconnect(),
    });
    const a = await oeffne(pageId, {
      onClose: (code) => h.onClose({ event: { code } }),
      extra: {
        onStatus: h.onStatus,
        onDisconnect: h.onDisconnect,
        onAuthenticationFailed: h.onAuthenticationFailed,
      },
    });
    ref.a = a;
    h.onSynced();
    expect(status).toBe("connected");
    let opens = 0;
    let closeEreignisse = 0;
    a.provider.on("open", () => {
      opens += 1;
    });
    // Je Schliessen genau ein Ereignis am Provider. (Die Rueckrufe aus
    // der Konfiguration ruft der Provider 4.4 je Ereignis zweimal auf, am
    // Socket und am Provider; statusHandlers ist dafuer wiederholbar.)
    a.provider.on("close", () => {
      closeEreignisse += 1;
    });

    tippe(a.doc, "x".repeat(3 * MiB));
    await warteBis(() => a.closes.includes(1009), "Close 1009", {
      timeoutMs: 5_000,
      log,
    });
    expect(status).toBe("too-large");
    await warteBis(
      () =>
        logZeilen("Collab-Nachricht ueber der Groessengrenze", pageId).length >
        0,
      "Logzeile zur Nachrichtengrenze",
      { timeoutMs: 5_000, log },
    );
    const [zeile] = logZeilen("Collab-Nachricht ueber der Groessengrenze", pageId);
    expect(zeile).toMatchObject({ userId, grenze: 2 * MiB });

    // Endgueltig getrennt: kein neuer Versuch.
    await pause(5_000);
    expect(opens).toBe(0);
    expect(closeEreignisse).toBe(1);
    expect(new Set(a.closes)).toEqual(new Set([1009]));
    expect(status).toBe("too-large");

    // Der Server laeuft weiter, die 3 MB sind nicht angekommen.
    const b = await oeffne(await neueSeite("danach"));
    expect(b.provider.isSynced).toBe(true);
    const stand = await gespeichert(pageId);
    expect(stand?.bytes ?? 0).toBeLessThan(MiB);

    // Unter der Nachrichtengrenze kommt auch ein grosser Absatz an.
    const anderthalb = await neueSeite("anderthalb");
    const c = await oeffne(anderthalb);
    tippe(c.doc, "y".repeat(1.5 * MiB));
    await warteBis(
      async () => ((await gespeichert(anderthalb))?.bytes ?? 0) > 1.5 * MiB,
      "1.5 MB gespeichert",
      { timeoutMs: 20_000, log },
    );
    expect(c.closes).toEqual([]);
  }, 60_000);

  it("T3 sperrt beim Wachsen ueber die Grenze, die Minutenrunde trennt nicht", async () => {
    const pageId = await neueSeite("wachsen");
    const a = await oeffne(pageId);
    const b = await oeffne(pageId);
    await warteBis(
      () => a.stufe() === "ok" && b.stufe() === "ok",
      "Hinweis ok beim Verbinden",
      { log },
    );

    tippe(a.doc, "a".repeat(600 * KiB));
    await warteBis(
      () => a.stufe() === "warn" && b.stufe() === "warn",
      "Warnung an beide",
      { log },
    );
    expect(logZeilen("Collab-Dokument ueber der Warnschwelle", pageId)).toHaveLength(1);

    tippe(a.doc, "a".repeat(600 * KiB));
    await warteBis(
      () => a.stufe() === "frozen" && b.stufe() === "frozen",
      "Sperre an beide",
      { log },
    );
    expect(
      logZeilen("Collab-Dokument ueber der Groessengrenze, nur noch lesbar", pageId),
    ).toHaveLength(1);
    await warteBis(
      async () => ((await gespeichert(pageId))?.bytes ?? 0) > MiB,
      "Stand ueber 1 MiB gespeichert",
      { timeoutMs: 20_000, log },
    );

    tippe(b.doc, "B-nach-der-Sperre");
    await pause(4_000);
    expect((await gespeichert(pageId))?.text).not.toContain("B-nach-der-Sperre");
    expect(b.closes).toEqual([]);

    // Eine Runde von enforceRevocations (fest 60 s): die gesperrte
    // Schreibverbindung ist kein Rollenwiderspruch.
    await pause(62_000);
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
    expect(
      logZeilen("Verbindung getrennt: Zugriff entzogen", pageId),
    ).toHaveLength(0);
    expect((await gespeichert(pageId))?.text).not.toContain("B-nach-der-Sperre");
  }, 120_000);

  it("T4 oeffnet einen Bestand ueber der Grenze nur lesbar", async () => {
    const q = await oeffne(bestand);
    await warteBis(() => q.stufe() === "frozen", "Sperre beim Oeffnen", { log });
    expect(q.hinweise.at(-1)).toMatchObject({ limitBytes: MiB });
    expect(q.hinweise.at(-1)!.bytes).toBeGreaterThan(1.5 * MiB);
    expect(
      logZeilen("Collab-Dokument ueber der Groessengrenze, nur noch lesbar", bestand)[0],
    ).toMatchObject({ quelle: "laden", level: 30 });
    tippe(q.doc, "in-der-sperre");
    await pause(4_000);
    expect((await gespeichert(bestand))?.text).not.toContain("in-der-sperre");
  }, 30_000);

  it("T5 hebt die Sperre auf, wenn eine kleinere Version wiederhergestellt wird", async () => {
    const r = await oeffne(bestand);
    await warteBis(() => r.stufe() === "frozen", "Sperre", { log });
    const synced: number[] = [];
    r.provider.on("synced", () => synced.push(Date.now()));

    const versionId = (
      await prisma.pageVersion.create({
        data: {
          pageId: bestand,
          title: `${TAG}-klein`,
          content: { type: "doc", content: [paragraph("klein-wiederhergestellt")] },
          textContent: "klein-wiederhergestellt",
        },
        select: { id: true },
      })
    ).id;
    const form = new FormData();
    form.set("slug", TAG);
    form.set("versionId", versionId);
    let url = "";
    try {
      await restoreVersionAction(form);
    } catch (e) {
      if (!(e instanceof mocks.Umleitung)) throw e;
      url = e.url;
    }
    expect(url).not.toBe("");
    expect(url).not.toContain(RESTORE_STALE_PARAM);

    await warteBis(() => r.stufe() === "ok", "Freigabe (ok)", { log });
    await warteBis(() => r.closes.length > 0, "Verbindung geschlossen", { log });
    // Der Provider verbindet selbst neu und gleicht ab.
    await warteBis(() => synced.length > 0 && r.provider.isSynced, "neu synchronisiert", {
      timeoutMs: 20_000,
      log,
    });
    tippe(r.doc, "nach-der-Freigabe");
    await warteBis(
      async () => (await gespeichert(bestand))?.text.includes("nach-der-Freigabe") ?? false,
      "Text nach der Freigabe gespeichert",
      { timeoutMs: 20_000, log },
    );
    expect((await gespeichert(bestand))?.text).toContain("klein-wiederhergestellt");
    expect(
      logZeilen("Collab-Dokument wieder unter der Groessengrenze", bestand),
    ).toHaveLength(1);
  }, 60_000);

  it("T6 lokale Kopie zuerst: nur mitgebracht bleibt die Nachricht klein", async () => {
    // Wie nach dem Laden der IndexedDB-Kopie vor dem Verbinden: Abgleich
    // ueber SyncStep1/2, nur die (leere) Differenz geht an den Server.
    const p1 = await oeffne(gross, { mitgebracht: grossState });
    await pause(3_000);
    expect(p1.closes).toEqual([]);
    expect(inhalt(p1.doc)).toContain("ggg");

    // Wie eine Kopie, die erst nach dem Start des Providers geladen wird:
    // der ganze Stand geht als EIN Update und ist groesser als 2 MiB.
    const p2 = await oeffne(gross, { warteAufSync: false });
    Y.applyUpdate(p2.doc, grossState);
    await warteBis(() => p2.closes.includes(1009), "Close 1009 fuer P2", {
      timeoutMs: 10_000,
      log,
    });
  }, 40_000);

  // Als letzter Fall: der Server wird neu gestartet.
  it("T7 nach einem Neustart mit hoeherer Grenze bekommt der Editor ok", async () => {
    const q = await oeffne(neustart);
    await warteBis(() => q.stufe() === "frozen", "Sperre", { log });
    const port = collab!.port;
    await collab!.stop();
    collab = await startePruefserver({
      redisDb: REDIS_DB,
      appSecret: getAppSecret(),
      exklusiv: true,
      port,
      env: { COLLAB_MAX_DOC_MB: "4" },
    });
    await warteBis(() => q.stufe() === "ok", "Hinweis ok nach dem Neustart", {
      timeoutMs: 45_000,
      log,
    });
    expect(q.hinweise.at(-1)).toMatchObject({ limitBytes: 4 * MiB });
  }, 90_000);
});
