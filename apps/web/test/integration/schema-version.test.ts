import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
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
const providers: HocuspocusProvider[] = [];
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
  hooks.user = null;
  await setzeEpoche(epocheVorher);
});

afterAll(async () => {
  for (const p of providers) p.destroy();
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
    const z = await readInstanceState(prisma);
    markeVorher = { version: z.editorSchemaVersion, hash: z.editorSchemaHash };
    // Der gemeinsame Server laeuft schon eine Weile; seine Minutenrunde
    // koennte die Marke mitten in einem Fall lesen. Frische Server je Fall.
    await collab?.stop();
    collab = null;
  }, 30_000);

  afterEach(async () => {
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
    expect(s.log()).toContain("Neuere Editor-Fassung in der Datenbank");
    a.provider.destroy();

    const b = await versuche(s, pageId);
    expect(b.synced).toBe(false);
    expect(b.gruende[0]).toBe(COLLAB_REJECT_REASON.schemaMismatch);
    expect(s.log()).toContain('"instanceOutdated":true');
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
