import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { Redis } from "ioredis";
import { decodeJwt } from "jose";
import { randomBytes } from "node:crypto";
import * as Y from "yjs";
import {
  currentRestoreEpoch,
  prisma,
  raiseEditorSchemaMark,
  readInstanceState,
} from "@dokunc/db";
import {
  COLLAB_FIELD,
  COLLAB_REJECT_REASON,
  SCHEMA_ANNOUNCE_CHANNEL,
  editorSchema,
  richExtensions,
} from "@dokunc/editor";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import {
  inhalt,
  schemaOhne,
  tippe,
  verbinde,
  warteBis,
  wieAlterEditor,
} from "./collab-hilfen";
import { starteWeiche, type Weiche } from "./redis-weiche";

/**
 * Editor-Schema zwischen Browser, Web-App und Collab-Server.
 *
 * Ein Tab mit aelterem Editor loescht beim Anzeigen alles aus dem
 * gemeinsamen Dokument, was sein Schema nicht kennt (@tiptap/y-tiptap),
 * und streicht beim Tippen unbekannte Attribute. Die Loeschung ginge an
 * alle und in die Datenbank. Deshalb vergleichen Ticket-Route und
 * Collab-Server den Schema-Hash, bevor ein Tab abgleichen darf.
 *
 * Der alte Tab ist hier ein Testclient mit reduziertem Schema: ohne
 * callout, highlight und textAlign, mit der Bindung des Browsers
 * (./collab-hilfen wieAlterEditor). Echte Route, echte Datenbank, echter
 * Collab-Server (eigener Prozess, Redis-Datenbank 7). Ersetzt ist nur die
 * Anmeldung.
 *
 * Mehrere Instanzen: jede hebt beim Start die Schema-Marke in
 * InstanceState; eine Instanz mit aelterem Schema trennt ihre Editoren
 * und nimmt keine neuen an. Die Faelle dazu stehen am Ende, starten je
 * einen frischen Server (dessen Minutenrunde laeuft dann sicher nicht
 * dazwischen) und setzen die Marke danach zurueck.
 *
 * Jeder Fall beendet seine Provider (afterEach). Ein Provider, der den
 * Fall ueberlebt, verbindet sich nach dem Ende seines Servers immer
 * wieder neu, auch zu einem spaeteren Server auf demselben Port; seine
 * Verbindungen und Abweisungen landeten dann in den Faellen danach.
 */

const REDIS_DB = 7;
vi.stubEnv("REDIS_URL", redisUrlMitDb(REDIS_DB));

const hooks = vi.hoisted(() => ({
  user: null as { id: string; tokenVersion: number; sessionId: string } | null,
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: vi.fn(async () => hooks.user),
}));

const { POST } = await import("@/app/api/collab/ticket/route");
const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `schema-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** Der alte Editor: ohne Callout, Hervorhebung und Ausrichtung. */
const ALT = schemaOhne(["callout", "highlight", "textAlign"]);

/** Inhalt mit allem, was der alte Editor nicht kennt. */
const INHALT = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "vorher" }] },
    {
      type: "callout",
      attrs: { type: "warning" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "im Callout" }] },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "markiert",
          marks: [{ type: "highlight", attrs: { color: "#ffee00" } }],
        },
      ],
    },
    {
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [{ type: "text", text: "zentriert" }],
    },
  ],
};

let collab: Pruefserver | null = null;
/** Provider des laufenden Falls; afterEach beendet sie. */
const providers: HocuspocusProvider[] = [];

function beendeProvider(): void {
  for (const p of providers.splice(0)) p.destroy();
}
let userId: string;
let sessionId: string;
let spaceId: string;
let epocheVorher: string | null = null;

async function setzeEpoche(epoch: string | null): Promise<void> {
  await prisma.instanceState.upsert({
    where: { id: 1 },
    update: { restoreEpoch: epoch },
    create: { id: 1, restoreEpoch: epoch },
  });
}

async function neueSeite(name: string): Promise<string> {
  const page = await prisma.page.create({
    data: {
      spaceId,
      title: `${TAG}-${name}`,
      content: INHALT,
      textContent: "vorher im Callout markiert zentriert",
    },
    select: { id: true },
  });
  return page.id;
}

function ticket(pageId: string, schemaHash?: string) {
  return () =>
    issueCollabTicket({
      userId,
      tokenVersion: 0,
      sessionId,
      pageId,
      restoreEpoch: epocheVorher,
      schemaHash,
    });
}

/** Das gespeicherte Yjs-Dokument einer Seite als Text. */
async function gespeichert(pageId: string): Promise<string> {
  const row = await prisma.collabDocument.findUnique({ where: { pageId } });
  if (!row) return "";
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.state));
  return inhalt(doc);
}

beforeAll(async () => {
  epocheVorher = await currentRestoreEpoch(prisma);
  collab = await startePruefserver({
    redisDb: REDIS_DB,
    appSecret: getAppSecret(),
    exklusiv: true,
  });
  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: "Schema", passwordHash: "x" },
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
        members: { create: [{ userId, role: "MEMBER" }] },
      },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterEach(async () => {
  beendeProvider();
  hooks.user = null;
  await setzeEpoche(epocheVorher);
});

afterAll(async () => {
  beendeProvider();
  await collab?.stop();
  vi.unstubAllEnvs();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe("Voraussetzung: ein alter Editor loescht, was er nicht kennt", () => {
  // Ohne diesen Fall bestuende der naechste auch dann, wenn der alte
  // Client gar nichts loeschte. Er schlaegt ausserdem an, wenn ein
  // Update von y-tiptap das Loeschen aendert.
  it("entfernt Callout, markierten Text und die Ausrichtung", () => {
    const voll = getSchema(richExtensions());
    const doc = prosemirrorJSONToYDoc(voll, INHALT, COLLAB_FIELD);
    const vorher = inhalt(doc);
    expect(vorher).toContain("<callout");
    expect(vorher).toContain("markiert");
    expect(vorher).toContain('textAlign="center"');

    expect(wieAlterEditor(doc, ALT.schema, "zentriert")).toBe(true);

    const nachher = inhalt(doc);
    expect(nachher).toContain("vorher");
    expect(nachher).not.toContain("<callout");
    expect(nachher).not.toContain("im Callout");
    expect(nachher).not.toContain("markiert");
    expect(nachher).toContain("zentriert!");
    expect(nachher).not.toContain("textAlign");
    expect(ALT.hash).not.toBe(editorSchema().hash);
  });
});

describe("Collab-Server und Editor-Schema", () => {
  it("weist einen alten Client ab, und nichts geht verloren", async () => {
    const pageId = await neueSeite("alt");

    // A: aktueller Editor.
    const a = await verbinde({ url: collab!.url, pageId, ticket: ticket(pageId) });
    providers.push(a.provider);
    expect(inhalt(a.doc)).toContain("<callout");
    expect(inhalt(a.doc)).toContain('textAlign="center"');

    // B: alter Editor mit eigenem Hash im Ticket.
    const gruende: string[] = [];
    let bSynced = false;
    const b = await verbinde({
      url: collab!.url,
      pageId,
      ticket: ticket(pageId, ALT.hash),
      warteAufSync: false,
      extra: {
        onAuthenticationFailed: ({ reason }: { reason: string }) => {
          gruende.push(reason);
        },
      },
    });
    providers.push(b.provider);
    b.provider.on("synced", () => {
      bSynced = true;
    });
    await warteBis(() => gruende.length > 0 || bSynced, "Ablehnung oder Abgleich", {
      timeoutMs: 10_000,
      log: () => collab?.log() ?? "",
    });

    // Was der alte Editor taete: anzeigen, tippen, einen Absatz anhaengen.
    wieAlterEditor(b.doc, ALT.schema, "zentriert");
    tippe(b.doc, "vom alten Client");

    // A schreibt weiter; danach ist der Speicherlauf sicher durch.
    tippe(a.doc, "danach");
    await warteBis(
      async () =>
        (
          await prisma.page.findUnique({
            where: { id: pageId },
            select: { textContent: true },
          })
        )?.textContent?.includes("danach") ?? false,
      "Speicherlauf mit 'danach'",
      { log: () => collab?.log() ?? "" },
    );
    // Gelegenheit fuer spaete Updates von B, falls es doch verbunden waere.
    await new Promise((r) => setTimeout(r, 1_000));

    expect(bSynced).toBe(false);
    expect(gruende[0]).toBe(COLLAB_REJECT_REASON.schemaMismatch);
    // Die Abweisung steht mit beiden Hashes im Log.
    expect(collab!.log()).toContain('"reason":"schema-mismatch"');
    expect(collab!.log()).toContain(`"schemaTicket":"${ALT.hash}"`);

    const seite = await prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true },
    });
    // Normales Bearbeiten loest keine der beiden Meldungen der
    // Speicherpruefung aus.
    expect(collab!.log()).not.toContain("Seiteninhalt nicht uebernommen");
    expect(collab!.log()).not.toContain("weicht vom Editor-Schema ab");
    for (const stand of [
      inhalt(a.doc),
      await gespeichert(pageId),
      JSON.stringify(seite?.content),
    ]) {
      expect(stand).toContain("callout");
      expect(stand).toContain("im Callout");
      expect(stand).toContain("highlight");
      expect(stand).toContain("markiert");
      expect(stand).toContain("textAlign");
      expect(stand).not.toContain("vom alten Client");
      expect(stand).not.toContain("zentriert!");
    }
  }, 60_000);

  it("weist ein Ticket ohne Schema ab", async () => {
    const pageId = await neueSeite("ohne-sh");
    const gruende: string[] = [];
    // Ein Ticket, wie es eine Web-App von vor dieser Pruefung ausstellte.
    const { SignJWT } = await import("jose");
    const { COLLAB_AUDIENCE } = await import("@dokunc/editor");
    const ohneSh = () =>
      new SignJWT({ tv: 0, sid: sessionId, pid: pageId, ep: epocheVorher })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setAudience(COLLAB_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("120s")
        .setJti(randomBytes(8).toString("hex"))
        .sign(new TextEncoder().encode(getAppSecret()));
    const b = await verbinde({
      url: collab!.url,
      pageId,
      ticket: ohneSh,
      warteAufSync: false,
      extra: {
        onAuthenticationFailed: ({ reason }: { reason: string }) => {
          gruende.push(reason);
        },
      },
    });
    providers.push(b.provider);
    await warteBis(() => gruende.length > 0 || b.provider.isSynced, "Ablehnung", {
      timeoutMs: 10_000,
      log: () => collab?.log() ?? "",
    });
    expect(b.provider.isSynced).toBe(false);
    expect(gruende[0]).toBe(COLLAB_REJECT_REASON.schemaMismatch);
    b.provider.destroy();
  }, 30_000);
});

describe("Speicherpruefung gegen das Editor-Schema", () => {
  async function seite(pageId: string) {
    return prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true, textContent: true },
    });
  }

  /** Logzeilen des Servers mit dieser Meldung und Seite. */
  function zeilen(meldung: string, pageId: string): string[] {
    return (collab?.log() ?? "")
      .split("\n")
      .filter((z) => z.includes(meldung) && z.includes(pageId));
  }

  it("speichert Unbekanntes nur im Yjs-Stand, Abweichendes mit Warnung", async () => {
    const pageId = await neueSeite("speichern");
    const c = await verbinde({ url: collab!.url, pageId, ticket: ticket(pageId) });
    providers.push(c.provider);
    const vorher = await seite(pageId);
    const versionenVorher = await prisma.pageVersion.count({ where: { pageId } });

    // 1. Ein Knoten, den das Schema nicht kennt (ein manipulierter oder
    //    neuerer Editor): bleibt im Yjs-Stand, erreicht Page.content nicht.
    const fragment = c.doc.getXmlFragment(COLLAB_FIELD);
    const fremd = new Y.XmlElement("zauberknoten");
    const text = new Y.XmlText();
    text.insert(0, "Hokuspokus");
    fremd.insert(0, [text]);
    fragment.push([fremd]);
    await warteBis(
      async () =>
        (await gespeichert(pageId)).includes("zauberknoten") &&
        zeilen("Seiteninhalt nicht uebernommen", pageId).length > 0,
      "Yjs-Stand gespeichert, Page.content abgelehnt",
      { log: () => collab?.log() ?? "" },
    );
    expect(zeilen("Seiteninhalt nicht uebernommen", pageId)[0]).toContain(
      '"unknownNodes":["zauberknoten"]',
    );
    const danach = await seite(pageId);
    expect(danach?.content).toEqual(vorher?.content);
    expect(danach?.textContent).toBe(vorher?.textContent);
    const versionen = await prisma.pageVersion.findMany({
      where: { pageId },
      select: { content: true },
    });
    expect(versionen.length).toBeGreaterThanOrEqual(versionenVorher);
    for (const v of versionen) {
      expect(JSON.stringify(v.content)).not.toContain("zauberknoten");
    }

    // 2. Ohne den fremden Knoten wird wieder alles gespeichert.
    c.doc.transact(() => {
      const i = fragment.toArray().indexOf(fremd);
      fragment.delete(i, 1);
    });
    tippe(c.doc, "wieder gut");
    await warteBis(
      async () => (await seite(pageId))?.textContent?.includes("wieder gut") ?? false,
      "Page.content mit 'wieder gut'",
      { log: () => collab?.log() ?? "" },
    );
    expect(JSON.stringify((await seite(pageId))?.content)).not.toContain(
      "zauberknoten",
    );

    // 3. Ein unbekanntes Attribut und eine leere Liste: dargestellt wird
    //    trotzdem, also speichern und warnen, hoechstens einmal je Stunde.
    c.doc.transact(() => {
      (fragment.get(0) as Y.XmlElement).setAttribute("farbe", "rot");
      fragment.push([new Y.XmlElement("bulletList")]);
    });
    tippe(c.doc, "abweichend");
    await warteBis(
      async () => (await seite(pageId))?.textContent?.includes("abweichend") ?? false,
      "Page.content mit 'abweichend'",
      { log: () => collab?.log() ?? "" },
    );
    await warteBis(
      () => zeilen("weicht vom Editor-Schema ab", pageId).length > 0,
      "Warnung im Log",
      { log: () => collab?.log() ?? "" },
    );
    const warnung = zeilen("weicht vom Editor-Schema ab", pageId)[0];
    expect(warnung).toContain('"unknownAttrs":["paragraph.farbe"]');
    expect(warnung).toContain("bulletList");
    tippe(c.doc, "noch einmal");
    await warteBis(
      async () => (await seite(pageId))?.textContent?.includes("noch einmal") ?? false,
      "Page.content mit 'noch einmal'",
      { log: () => collab?.log() ?? "" },
    );
    expect(zeilen("weicht vom Editor-Schema ab", pageId)).toHaveLength(1);
    c.provider.destroy();
  }, 90_000);
});

describe("Ticket-Route und Editor-Schema", () => {
  let pageId: string;
  const E = randomBytes(16).toString("hex");

  function anfrage(body: Record<string, unknown>): Request {
    return new Request(`${APP_URL}/api/collab/ticket`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: APP_URL,
        host: new URL(APP_URL).host,
      },
    });
  }

  async function antwort(body: Record<string, unknown>) {
    const res = await POST(anfrage(body));
    return {
      status: res.status,
      cache: res.headers.get("cache-control"),
      data: (await res.json()) as { ticket?: string; code?: string },
    };
  }

  const angemeldet = () => {
    hooks.user = { id: userId, tokenVersion: 0, sessionId };
  };

  beforeAll(async () => {
    pageId = await neueSeite("route");
  });

  it("stellt mit dem Schema der Web-App ein Ticket mit sh aus", async () => {
    angemeldet();
    const r = await antwort({ pageId, epoch: epocheVorher, schema: editorSchema().hash });
    expect(r.status).toBe(200);
    expect(decodeJwt(r.data.ticket!).sh).toBe(editorSchema().hash);
  });

  it.each([
    ["mit anderem Schema", () => ({ schema: ALT.hash })],
    ["ohne Feld schema (Tab von vor dieser Pruefung)", () => ({})],
    ["mit schema als Zahl", () => ({ schema: 1 })],
  ])("antwortet 409 stale-client %s", async (_, extra) => {
    angemeldet();
    const r = await antwort({ pageId, epoch: epocheVorher, ...extra() });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe(COLLAB_REJECT_REASON.staleClient);
    expect(r.cache).toBe("no-store");
  });

  // Ein veralteter Tab mit abgelaufener Sitzung soll "neu laden" zeigen,
  // nicht "kein Zugriff"; die Anmeldung kommt nach dem Neuladen.
  it("antwortet ohne Sitzung 409 stale-client bei anderem Schema", async () => {
    const r = await antwort({ pageId, epoch: epocheVorher, schema: ALT.hash });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe(COLLAB_REJECT_REASON.staleClient);
  });

  it("antwortet ohne Sitzung mit passendem Schema weiter 401", async () => {
    const r = await antwort({ pageId, epoch: epocheVorher, schema: editorSchema().hash });
    expect(r.status).toBe(401);
  });

  // Die Restore-Epoche geht vor: ihr Hinweis sagt, dass Text seit der
  // Sicherung fehlt, und das darf "neue Version" nicht verdecken.
  it("meldet eine abweichende Epoche vor einem abweichenden Schema", async () => {
    await setzeEpoche(E);
    angemeldet();
    const r = await antwort({ pageId, epoch: null, schema: ALT.hash });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe(COLLAB_REJECT_REASON.restoreEpoch);
  });

  it("meldet ohne Sitzung eine abweichende Epoche vor einem abweichenden Schema", async () => {
    await setzeEpoche(E);
    const r = await antwort({ pageId, epoch: null, schema: ALT.hash });
    expect(r.status).toBe(409);
    expect(r.data.code).toBe(COLLAB_REJECT_REASON.restoreEpoch);
  });
});

describe("Schema-Marke in InstanceState", () => {
  /** Laeuft in einer Transaktion, die am Ende zurueckgerollt wird. */
  async function inTransaktion(
    fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>,
  ): Promise<void> {
    const zurueck = new Error("zurueckrollen");
    await expect(
      prisma.$transaction(async (tx) => {
        await fn(tx);
        throw zurueck;
      }),
    ).rejects.toBe(zurueck);
  }

  const H1 = "1111111111111111";
  const H2 = "2222222222222222";

  it("steigt nur, und der Hash folgt der Version", async () => {
    await inTransaktion(async (tx) => {
      await tx.$executeRaw`UPDATE "InstanceState" SET "editorSchemaVersion" = 0, "editorSchemaHash" = NULL`;
      expect(await raiseEditorSchemaMark(tx, { version: 1, hash: H1 })).toEqual({
        version: 1,
        hash: H1,
      });
      // Gleiche Version, anderer Hash: der erste bleibt.
      expect(await raiseEditorSchemaMark(tx, { version: 1, hash: H2 })).toEqual({
        version: 1,
        hash: H1,
      });
      // Eine aeltere Instanz senkt nichts.
      expect(await raiseEditorSchemaMark(tx, { version: 0, hash: H2 })).toEqual({
        version: 1,
        hash: H1,
      });
      expect(await raiseEditorSchemaMark(tx, { version: 2, hash: H2 })).toEqual({
        version: 2,
        hash: H2,
      });
      expect(await readInstanceState(tx)).toMatchObject({
        editorSchemaVersion: 2,
        editorSchemaHash: H2,
      });
    });
  });

  it("legt die Zeile an, wenn sie fehlt, und liest ohne Zeile 0", async () => {
    await inTransaktion(async (tx) => {
      await tx.instanceState.deleteMany();
      expect(await readInstanceState(tx)).toEqual({
        restoreEpoch: null,
        editorSchemaVersion: 0,
        editorSchemaHash: null,
      });
      expect(await raiseEditorSchemaMark(tx, { version: 1, hash: H1 })).toEqual({
        version: 1,
        hash: H1,
      });
    });
  });

  it("erzwingt Format des Hashes und eine Version ab 0", async () => {
    for (const [sql, bedingung] of [
      [`UPDATE "InstanceState" SET "editorSchemaHash" = 'xyz'`, "InstanceState_editorSchemaHash_format"],
      [`UPDATE "InstanceState" SET "editorSchemaVersion" = -1`, "InstanceState_editorSchemaVersion_range"],
    ] as const) {
      let fehler = "";
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(sql);
        });
      } catch (e) {
        fehler = `${String(e)} ${JSON.stringify((e as { meta?: unknown }).meta ?? null)}`;
      }
      expect(fehler).toContain("23514");
      expect(fehler).toContain(bedingung);
    }
  });
});

describe("Veraltete Instanz", () => {
  const eigen = editorSchema();
  /** Eine Fassung, die es nicht gibt: neuer als diese hier. */
  const NEUER = { version: eigen.version + 1, hash: "ffffffffffffffff" };
  let markeVorher: { version: number; hash: string | null };
  let server: Pruefserver | null = null;

  async function setzeMarke(m: { version: number; hash: string | null }) {
    await prisma.$executeRaw`UPDATE "InstanceState" SET "editorSchemaVersion" = ${m.version}, "editorSchemaHash" = ${m.hash} WHERE "id" = 1`;
  }

  async function starte(): Promise<Pruefserver> {
    server = await startePruefserver({
      redisDb: REDIS_DB,
      appSecret: getAppSecret(),
      exklusiv: true,
    });
    return server;
  }

  /** Verbindet und sammelt die Gruende einer Ablehnung. */
  async function versuche(s: Pruefserver, pageId: string) {
    const gruende: string[] = [];
    const v = await verbinde({
      url: s.url,
      pageId,
      ticket: ticket(pageId),
      warteAufSync: false,
      extra: {
        onAuthenticationFailed: ({ reason }: { reason: string }) => {
          gruende.push(reason);
        },
      },
    });
    providers.push(v.provider);
    await warteBis(() => gruende.length > 0 || v.provider.isSynced, "Ablehnung oder Abgleich", {
      timeoutMs: 10_000,
      log: s.log,
    });
    return { synced: v.provider.isSynced, gruende, provider: v.provider };
  }

  beforeAll(async () => {
    // Die frischen Server dieser Faelle sollen nur die eigenen Editoren
    // sehen (siehe Kopf der Datei).
    expect(providers, "Provider frueherer Faelle noch offen").toHaveLength(0);
    const z = await readInstanceState(prisma);
    markeVorher = { version: z.editorSchemaVersion, hash: z.editorSchemaHash };
    // Der gemeinsame Server laeuft schon eine Weile; seine Minutenrunde
    // koennte die Marke mitten in einem Fall lesen. Frische Server je Fall.
    await collab?.stop();
    collab = null;
  }, 30_000);

  afterEach(async () => {
    // Vor dem Server: sonst versuchen es seine Provider bis zum
    // aeusseren afterEach weiter.
    beendeProvider();
    await server?.stop();
    server = null;
    await setzeMarke(markeVorher);
  }, 30_000);

  it("hebt die Marke beim Start, trennt bei der Ankuendigung einer neueren Fassung und weist neue ab", async () => {
    await setzeMarke({ version: 0, hash: null });
    const s = await starte();
    expect(await readInstanceState(prisma)).toMatchObject({
      editorSchemaVersion: eigen.version,
      editorSchemaHash: eigen.hash,
    });

    const pageId = await neueSeite("veraltet-ankuendigung");
    let geschlossen = false;
    const a = await verbinde({
      url: s.url,
      pageId,
      ticket: ticket(pageId),
      onClose: () => {
        geschlossen = true;
      },
    });
    providers.push(a.provider);

    // Eine neuere Instanz startet: sie hebt die Marke und kuendigt sich an.
    await setzeMarke(NEUER);
    await s.redis.publish(
      SCHEMA_ANNOUNCE_CHANNEL,
      JSON.stringify({ instanceId: `${TAG}-neu`, ...NEUER }),
    );
    await warteBis(() => geschlossen, "Editor getrennt", {
      timeoutMs: 5_000,
      log: s.log,
    });
    // Getrennt hat sie genau diesen einen Editor; mehr hiesse, dass
    // Provider eines frueheren Falls hier verbunden waren.
    const wechsel = s
      .log()
      .split("\n")
      .filter((z) => z.includes("Neuere Editor-Fassung in der Datenbank"));
    expect(wechsel).toHaveLength(1);
    expect(wechsel[0]).toContain('"closed":1');
    a.provider.destroy();

    // Das Ticket nennt das Schema dieses Servers: abgewiesen wird es nur,
    // weil die Instanz veraltet ist. (Die Logzeile dazu ist gedrosselt und
    // deshalb kein Beleg.)
    const b = await versuche(s, pageId);
    expect(b.synced).toBe(false);
    expect(b.gruende[0]).toBe(COLLAB_REJECT_REASON.schemaMismatch);
    b.provider.destroy();
  }, 60_000);

  it("merkt eine neuere Marke bei der naechsten Anmeldung, auch ohne Ankuendigung", async () => {
    const s = await starte();
    const pageId = await neueSeite("veraltet-anmeldung");
    let geschlossen = false;
    const a = await verbinde({
      url: s.url,
      pageId,
      ticket: ticket(pageId),
      onClose: () => {
        geschlossen = true;
      },
    });
    providers.push(a.provider);

    await setzeMarke(NEUER);
    const b = await versuche(s, pageId);
    expect(b.synced).toBe(false);
    expect(b.gruende[0]).toBe(COLLAB_REJECT_REASON.schemaMismatch);
    // Die schon offenen Editoren trennt sie dabei ebenfalls.
    await warteBis(() => geschlossen, "Editor getrennt", {
      timeoutMs: 5_000,
      log: s.log,
    });
    a.provider.destroy();
    b.provider.destroy();
  }, 60_000);

  // Eine Anmeldung, die beim Wechsel schon durch ist, deren Dokument
  // aber noch laedt, steht in keinem Dokument; trenneVeraltet findet sie
  // nicht. Ohne weitere Pruefung bliebe sie an der veralteten Instanz.
  // Was sie waehrend des Ladens geschrieben hat, darf die veraltete
  // Instanz auch nicht mehr uebernehmen.
  it("trennt auch eine Verbindung, die beim Wechsel noch im Aufbau war, und uebernimmt nichts von ihr", async () => {
    const s = await starte();
    const pageId = await neueSeite("veraltet-aufbau");

    // Das Laden anhalten: onLoadDocument liest zuerst CollabDocument.
    // Die Tabelle bleibt gesperrt, bis der Wechsel durch ist.
    let freigeben = () => {};
    const freigabe = new Promise<void>((r) => {
      freigeben = r;
    });
    let gesperrt = () => {};
    const sperreSteht = new Promise<void>((r) => {
      gesperrt = r;
    });
    const sperre = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "CollabDocument" IN ACCESS EXCLUSIVE MODE`;
        gesperrt();
        await freigabe;
      },
      { timeout: 30_000 },
    );
    try {
      await sperreSteht;
      let geschlossen = false;
      const a = await verbinde({
        url: s.url,
        pageId,
        ticket: ticket(pageId),
        warteAufSync: false,
        onClose: () => {
          geschlossen = true;
        },
      });
      providers.push(a.provider);
      // Die Anmeldung ist durch (Ticket, Zugriff, Marke), der Server
      // wartet beim Laden auf die Sperre.
      await warteBis(
        async () => {
          const [z] = await prisma.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_locks l
            JOIN pg_class c ON c.oid = l.relation
            WHERE c.relname = 'CollabDocument' AND NOT l.granted
              AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
          return (z?.n ?? 0) > 0;
        },
        "Laden wartet auf die Sperre",
        { timeoutMs: 10_000, log: s.log },
      );

      await setzeMarke(NEUER);
      await s.redis.publish(
        SCHEMA_ANNOUNCE_CHANNEL,
        JSON.stringify({ instanceId: `${TAG}-neu`, ...NEUER }),
      );
      await warteBis(
        () => s.log().includes("Neuere Editor-Fassung in der Datenbank"),
        "Wechsel im Log",
        { timeoutMs: 5_000, log: s.log },
      );
      // Beim Wechsel war noch keine Verbindung eingetragen.
      expect(s.log()).toContain('"closed":0');

      // Der Editor schreibt weiter. Der Server puffert die Nachricht, bis
      // das Dokument geladen ist, und gibt sie dann vor `connected` weiter.
      tippe(a.doc, "nach dem Wechsel geschrieben");
      await new Promise((r) => setTimeout(r, 300));

      freigeben();
      await sperre;
      await warteBis(() => geschlossen, "Verbindung nach dem Aufbau getrennt", {
        timeoutMs: 5_000,
        log: s.log,
      });
      // Entladen ist das Dokument erst, wenn kein Speicherlauf mehr
      // aussteht (Kanal der HA-Erweiterung, siehe server.ts).
      await warteBis(
        async () => {
          const [, n] = (await s.redis.pubsub("NUMSUB", `hocuspocus:${pageId}`)) as [
            string,
            number | string,
          ];
          return Number(n) === 0;
        },
        "Dokument entladen",
        { timeoutMs: 10_000, log: s.log },
      );
      // Geladen und angelegt wurde es, gespeichert ist ohne das Getippte.
      const stand = await gespeichert(pageId);
      expect(stand).toContain("<callout");
      expect(stand).not.toContain("nach dem Wechsel geschrieben");
    } finally {
      freigeben();
      await sperre.catch(() => undefined);
    }
  }, 60_000);

  // Rueckweg ohne Sicherung: die aeltere Fassung startet auf Daten, in
  // denen die neuere schon steht. Sie darf keine einzige Verbindung
  // annehmen, und die Marke bleibt, wo sie ist.
  it("nimmt nach einem Start unter einer hoeheren Marke keine Verbindung an", async () => {
    await setzeMarke(NEUER);
    const s = await starte();
    expect(s.log()).toContain("Editor-Schema dieser Instanz ist aelter als die Marke");
    expect(await readInstanceState(prisma)).toMatchObject({
      editorSchemaVersion: NEUER.version,
      editorSchemaHash: NEUER.hash,
    });

    const pageId = await neueSeite("veraltet-start");
    const b = await versuche(s, pageId);
    expect(b.synced).toBe(false);
    expect(b.gruende[0]).toBe(COLLAB_REJECT_REASON.schemaMismatch);
    b.provider.destroy();
  }, 60_000);
});

describe("Start, waehrend Redis nicht antwortet", () => {
  // Entschieden wird ueber die Marke in der Datenbank; die Ankuendigung
  // ueber Redis ist nur der schnelle Weg. Ein Redis, das Verbindungen
  // annimmt und nicht antwortet (oder ein Host, der nicht erreichbar
  // ist), hielte einen Befehl lange auf; der Port darf nicht darauf
  // warten.
  const STILLE_MS = 4_000;
  let weiche: Weiche | null = null;
  let server: Pruefserver | null = null;
  let empfang: Redis | null = null;

  afterAll(async () => {
    await server?.stop();
    await weiche?.schliessen();
    empfang?.disconnect();
  }, 30_000);

  it("oeffnet den Port, ohne auf die Ankuendigung zu warten, und kuendigt danach an", async () => {
    // Mitlesen am echten Redis, an der Weiche vorbei.
    const angekuendigt: string[] = [];
    empfang = new Redis(redisUrlMitDb(REDIS_DB), { maxRetriesPerRequest: 1 });
    empfang.on("message", (_kanal: string, m: string) => angekuendigt.push(m));
    await empfang.subscribe(SCHEMA_ANNOUNCE_CHANNEL);

    weiche = await starteWeiche(redisUrlMitDb(REDIS_DB), STILLE_MS, {
      schweigen: true,
    });
    // Bereit meldet der Pruefstand den Server erst, wenn Redis antwortet.
    server = await startePruefserver({
      redisDb: REDIS_DB,
      appSecret: getAppSecret(),
      env: { REDIS_URL: weiche.url },
    });
    const offen = weiche.geoeffnetUm();
    expect(offen).not.toBeNull();
    const zeit = (msg: string) => {
      const zeile = server!
        .log()
        .split("\n")
        .find((z) => z.includes(`"msg":"${msg}"`));
      expect(zeile, `Logzeile "${msg}" fehlt:\n${server!.log()}`).toBeDefined();
      return (JSON.parse(zeile!) as { time: number }).time;
    };
    // Die Marke steht vor dem Port, der Port vor der Antwort von Redis.
    expect(zeit("Editor-Schema")).toBeLessThanOrEqual(zeit("Hocuspocus läuft"));
    expect(zeit("Hocuspocus läuft")).toBeLessThan(offen!);

    // Angekuendigt wird trotzdem, sobald Redis antwortet.
    const eigen = editorSchema();
    await warteBis(
      () =>
        angekuendigt.some((m) => {
          const a = JSON.parse(m) as { version?: number; hash?: string };
          return a.version === eigen.version && a.hash === eigen.hash;
        }),
      "Ankuendigung des eigenen Schemas",
      { timeoutMs: 10_000, log: server.log },
    );
  }, 60_000);
});
