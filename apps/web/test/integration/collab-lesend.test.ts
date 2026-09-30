import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MessageType, type HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { currentRestoreEpoch, prisma } from "@dokunc/db";
import { COLLAB_FIELD } from "@dokunc/editor";
import {
  redisUrlMitDb,
  startePruefserver,
  type Pruefserver,
} from "./collab-pruefserver";
import { inhalt, tippe, verbinde, warteBis } from "./collab-hilfen";

/**
 * Schreibschutz lesender Verbindungen, gegen einen echten Collab-Server
 * (eigener Prozess, Redis-Datenbank 9, siehe ./collab-pruefserver).
 *
 * Der Collab-Server gibt einer Verbindung `readOnly`, wenn die Rolle im
 * Space VIEWER ist (checkTicketAccess), und Hocuspocus verwirft dann
 * Update und SyncStep2 dieser Verbindung und antwortet mit SyncStatus
 * "nicht uebernommen". Geprueft wird das an allem, was ein Tab eines
 * Betrachters schicken kann: Tippen, eine mitgebrachte Kopie mit
 * Offline-Aenderung und das Weitertippen nach einer Herabstufung waehrend
 * der offenen Sitzung. Dazu die Bindung des Tickets an seine Seite.
 *
 * Verworfen heisst jeweils: nicht bei der anderen Verbindung, nicht im
 * gespeicherten Yjs-Stand (CollabDocument) und nicht in Page.content.
 * Damit der Speicherlauf sicher nach dem Schreibversuch liegt, wartet
 * jeder Fall auf die Antwort des Servers auf genau diesen Versuch
 * (SyncStatus) und laesst danach die schreibende Person eine Marke
 * tippen; erst wenn Page.content die Marke traegt (Speicherlauf beim
 * Trennen), wird geprueft.
 *
 * changeRoleAction laeuft echt (Datenbank, Redis-Kanal zum
 * Collab-Server); ersetzt sind Anmeldung, Anfrage-Header und Cache.
 */

const REDIS_DB = 9;
vi.stubEnv("REDIS_URL", redisUrlMitDb(REDIS_DB));

type Actor = { id: string; email: string; name: string; isAdmin: boolean };
const mocks = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => mocks.actor),
  requireAdmin: vi.fn(async () => mocks.actor),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const { changeRoleAction } = await import("@/app/s/[slug]/members/actions");
const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `lese-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Konto = Actor & { sessionId: string };

let collab: Pruefserver | null = null;
let providers: HocuspocusProvider[] = [];
let spaceId: string;
let epoche: string | null;
let owner: Konto;
let member: Konto;
let viewer: Konto;
let memberSchaft: string;

async function konto(name: string): Promise<Konto> {
  const u = await prisma.user.create({
    data: { email: `${TAG}-${name}@example.test`, name, passwordHash: "x" },
    select: { id: true, email: true, name: true },
  });
  const s = await prisma.session.create({
    data: { userId: u.id, expiresAt: new Date(Date.now() + 3_600_000) },
    select: { id: true },
  });
  return { ...u, isAdmin: false, sessionId: s.id };
}

/** Eine Seite mit dem Absatz "Start" (noch ohne Yjs-Stand). */
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

/** Ticket-Funktion fuer den Provider: je Aufruf ein frisches Ticket. */
function ticketFuer(k: Konto, pageId: string): () => Promise<string> {
  return () =>
    issueCollabTicket({
      userId: k.id,
      tokenVersion: 0,
      sessionId: k.sessionId,
      pageId,
      restoreEpoch: epoche,
    });
}

/**
 * Antworten des Servers auf Schreibversuche (SyncStatus je Update oder
 * SyncStep2): true = uebernommen, false = verworfen. Der Provider selbst
 * wertet nur "uebernommen" aus. Mitgeschrieben ab dem ersten Byte: auch
 * der Abgleich beim Verbinden bekommt eine Antwort (auf den SyncStep2,
 * mit dem der Tab den ersten Sync-Schritt des Servers beantwortet).
 */
function statusMitschrift(antworten: boolean[]) {
  // Der Provider reicht seine Konfiguration samt onMessage auch an seine
  // WebSocket-Verbindung weiter; die ruft es mit dem rohen Ereignis auf.
  // Gezaehlt wird nur der Aufruf des Providers, der die Nachricht traegt.
  return (payload: {
    message?: { readVarString(): string; readVarUint(): number };
  }) => {
    const { message } = payload;
    if (!message) return;
    message.readVarString();
    if (message.readVarUint() !== MessageType.SyncStatus) return;
    // writeVarInt(1 | 0): fuer 0 und 1 dasselbe Byte wie als VarUint.
    antworten.push(message.readVarUint() === 1);
  };
}

/**
 * Verbinden und warten, bis der Server auch den Abgleich beim Verbinden
 * beantwortet hat. Jede weitere Antwort in `status` gehoert dann zu
 * einem Schreibversuch des Tests.
 */
async function oeffne(k: Konto, pageId: string, mitgebracht?: Uint8Array) {
  const geschlossen: (number | undefined)[] = [];
  const status: boolean[] = [];
  const v = await verbinde({
    url: collab!.url,
    pageId,
    ticket: ticketFuer(k, pageId),
    mitgebracht,
    onClose: (code) => geschlossen.push(code),
    extra: { onMessage: statusMitschrift(status) },
  });
  providers.push(v.provider);
  let syncs = 1;
  v.provider.on("synced", () => (syncs += 1));
  await warteBis(() => status.length > 0, "Antwort auf den ersten Abgleich", {
    log: collab!.log,
  });
  return { ...v, status, geschlossen, syncs: () => syncs };
}

async function yjsText(pageId: string): Promise<string> {
  const row = await prisma.collabDocument.findUnique({
    where: { pageId },
    select: { state: true },
  });
  if (!row) return "";
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.state));
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
 * Die schreibende Person tippt `marke`, `leser` wartet darauf; dann
 * trennen alle, und der Speicherlauf beim Trennen schreibt die Marke nach
 * Page.content. Danach liegt ein Speicherlauf sicher hinter jedem
 * frueheren Schreibversuch.
 */
async function gespeichertBisMarke(
  pageId: string,
  schreiber: { doc: Y.Doc },
  leser: { doc: Y.Doc },
  marke: string,
): Promise<void> {
  tippe(schreiber.doc, marke);
  await warteBis(
    () => inhalt(leser.doc).includes(marke),
    `${marke} beim Leser`,
    {
      log: collab!.log,
    },
  );
  for (const p of providers) p.destroy();
  providers = [];
  await warteBis(
    async () => (await seitenInhalt(pageId)).includes(marke),
    `${marke} in Page.content`,
    { log: collab!.log },
  );
}

async function nirgends(
  pageId: string,
  text: string,
  andere: { doc: Y.Doc },
): Promise<void> {
  expect(inhalt(andere.doc)).not.toContain(text);
  expect(await yjsText(pageId)).not.toContain(text);
  expect(await seitenInhalt(pageId)).not.toContain(text);
}

beforeAll(async () => {
  collab = await startePruefserver({
    redisDb: REDIS_DB,
    appSecret: getAppSecret(),
    exklusiv: true,
  });
  epoche = await currentRestoreEpoch(prisma);
  owner = await konto("owner");
  member = await konto("member");
  viewer = await konto("viewer");
  const space = await prisma.space.create({
    data: {
      name: TAG,
      slug: TAG,
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: member.id, role: "MEMBER" },
          { userId: viewer.id, role: "VIEWER" },
        ],
      },
    },
    select: { id: true, members: { select: { id: true, userId: true } } },
  });
  spaceId = space.id;
  memberSchaft = space.members.find((m) => m.userId === member.id)!.id;
  mocks.actor = owner;
}, 60_000);

afterEach(() => {
  for (const p of providers) p.destroy();
  providers = [];
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await collab?.stop();
  vi.unstubAllEnvs();
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe("Schreibschutz lesender Collab-Verbindungen", () => {
  it("verwirft, was ein Betrachter tippt", async () => {
    const pageId = await neueSeite("tippen");
    const o = await oeffne(owner, pageId);
    const v = await oeffne(viewer, pageId);
    // Positivkontrolle: die lesende Verbindung ist live.
    tippe(o.doc, "O-1");
    await warteBis(() => inhalt(v.doc).includes("O-1"), "O-1 beim Betrachter");

    // Der Abgleich beim Verbinden brachte nichts Neues: uebernommen.
    expect(v.status).toEqual([true]);
    tippe(v.doc, "V-1");
    await warteBis(() => v.status.length > 1, "Antwort auf V-1", {
      log: collab!.log,
    });

    await gespeichertBisMarke(pageId, o, v, "O-Marke");
    await nirgends(pageId, "V-1", o);
    expect(v.status).toEqual([true, false]);
    expect(await yjsText(pageId)).toContain("O-1");
    expect(await seitenInhalt(pageId)).toContain("O-1");
  });

  it("verwirft die Offline-Aenderung einer mitgebrachten Kopie", async () => {
    const pageId = await neueSeite("kopie");
    const o = await oeffne(owner, pageId);
    // Die Kopie im Browser: der Stand der Seite und ein Absatz, den der
    // Tab offline getippt hat. Beim Verbinden geht er als SyncStep2.
    const kopie = new Y.Doc();
    Y.applyUpdate(kopie, Y.encodeStateAsUpdate(o.doc));
    tippe(kopie, "V-offline");
    expect(kopie.getXmlFragment(COLLAB_FIELD).length).toBe(2);

    const v = await oeffne(viewer, pageId, Y.encodeStateAsUpdate(kopie));

    await gespeichertBisMarke(pageId, o, v, "O-Marke");
    await nirgends(pageId, "V-offline", o);
    expect(v.status).toEqual([false]);
  });

  it("nimmt einem zur Laufzeit herabgestuften Mitglied das Schreiben", async () => {
    const pageId = await neueSeite("herab");
    const o = await oeffne(owner, pageId);
    const m = await oeffne(member, pageId);
    tippe(m.doc, "M-1");
    await warteBis(() => inhalt(o.doc).includes("M-1"), "M-1 beim Owner");
    await warteBis(() => m.status.length > 1, "Antwort auf M-1");
    expect(m.status).toEqual([true, true]);

    const form = new FormData();
    form.set("slug", TAG);
    form.set("memberId", memberSchaft);
    form.set("role", "VIEWER");
    const vorher = Date.now();
    await changeRoleAction(form);

    // Getrennt ueber den Redis-Kanal (revokeCollabAccess), nicht erst in
    // der Minutenrunde, und mit frischem Ticket neu verbunden.
    await warteBis(() => m.geschlossen.length > 0, "Mitglied getrennt", {
      timeoutMs: 10_000,
      log: collab!.log,
    });
    expect(Date.now() - vorher).toBeLessThan(10_000);
    await warteBis(() => m.syncs() >= 2, "Mitglied wieder synchronisiert", {
      log: collab!.log,
    });
    // Auch der Abgleich nach dem Neuverbinden ist beantwortet.
    await warteBis(() => m.status.length > 2, "Antwort auf den neuen Abgleich");

    tippe(m.doc, "M-2");
    await warteBis(() => m.status.length > 3, "Antwort auf M-2", {
      log: collab!.log,
    });

    await gespeichertBisMarke(pageId, o, m, "O-Marke");
    await nirgends(pageId, "M-2", o);
    expect(m.status).toEqual([true, true, true, false]);
    expect(await seitenInhalt(pageId)).toContain("M-1");
  }, 40_000);

  it("weist ein Ticket fuer eine andere Seite ab", async () => {
    const p = await neueSeite("ziel");
    const q = await neueSeite("andere");
    const gruende: string[] = [];
    let synced = false;
    const start = Date.now();
    // Ein gueltiges Ticket derselben Person, aber fuer Seite Q.
    const { provider } = await verbinde({
      url: collab!.url,
      pageId: p,
      ticket: ticketFuer(member, q),
      warteAufSync: false,
      extra: {
        onAuthenticationFailed: ({ reason }: { reason: string }) =>
          gruende.push(reason),
      },
    });
    providers.push(provider);
    provider.on("synced", () => (synced = true));
    await warteBis(() => gruende.length > 0, "Anmeldung abgewiesen", {
      timeoutMs: 5_000,
      log: collab!.log,
    });
    expect(gruende[0]).toBe("permission-denied");
    // Auch danach kein Abgleich (bis 5 s nach dem Verbinden).
    await new Promise((r) =>
      setTimeout(r, Math.max(0, start + 5_000 - Date.now())),
    );
    expect(synced).toBe(false);
    expect(
      await prisma.collabDocument.findUnique({ where: { pageId: p } }),
    ).toBeNull();
    expect(await seitenInhalt(p)).toContain("Start");
  });
});
