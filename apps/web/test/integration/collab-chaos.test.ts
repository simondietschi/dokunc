import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { currentRestoreEpoch, prisma } from "@dokunc/db";
import {
  inhalt,
  textImCollabDocument,
  textInPageContent,
  tippe,
  verbinde,
  warteBis,
} from "./collab-hilfen";
import { startePruefserver, type Pruefserver } from "./collab-pruefserver";
import {
  redisServerVorhanden,
  starteEigenesRedis,
  type EigenesRedis,
} from "./redis-privat";

/**
 * Ausfalltest: zwei Collab-Instanzen, ein eigenes redis-server, das der
 * Test anhaelt, voll macht oder neu startet, waehrend zwei Editoren tippen.
 *
 * Messregel: Editor 1 (Owner) an Instanz A, Editor 2 (Mitglied) an
 * Instanz B, eine eigene Seite je Fall. Jeder haengt alle 200 ms einen
 * Absatz mit einem eindeutigen Token an. Nach dem Tippende tippt niemand
 * mehr; binnen 30 s muessen gelten:
 *  1. jedes Token steht im gespeicherten Yjs-Stand (CollabDocument);
 *  2. jedes Token steht in Page.content;
 *  3. jeder Editor, der noch verbunden ist, zeigt jedes Token: die
 *     Instanzen haben ohne weiteres Tippen abgeglichen (ein Editor, der
 *     vorher getrennt hat, zeigt nichts mehr);
 *  4. beide Collab-Prozesse laufen noch, und es sind dieselben;
 *  5. kein Log enthaelt "Unbehandelte Ablehnung", "Unbehandelter Fehler"
 *     oder "Speicherlauf gescheitert".
 * Dazu in Fall 1a:
 *  6. eine neue Verbindung zu einer Seite, die keine Instanz geladen hat,
 *     ist 10 s nach Beginn des Ausfalls binnen GRENZE_NEUE_VERBINDUNG_MS
 *     synchronisiert und wird nie abgewiesen (der Editor zeigte sonst
 *     "Kein Zugriff").
 * Je Fall steht eine JSON-Zeile mit den Messwerten im Log.
 *
 * Zeitachsen (Redis weg): ioredis baut die Verbindung mit wachsendem
 * Abstand neu auf (50 ms mehr je Versuch, hoechstens 2 s,
 * ./apps/collab/src/redis-client.ts), und bei zwei Versuchen je Befehl
 * lehnt es wartende Befehle bei jedem dritten gescheiterten Versuch ab.
 * 10 s nach Beginn liegen die Versuche etwa 1 s auseinander, ein Befehl
 * wartet also 0 bis 3 s.
 *
 * Fall 1a, Redis 30 s weg, beide bleiben verbunden. 0 s: anhalten, beide
 * tippen. 10 s: Editor 3 oeffnet eine ungeladene Seite an A (Kriterium
 * 6). 30 s: starten, Tippende. Frueher: jeder Speicherlauf im Ausfall
 * scheiterte an Redlock und wurde verworfen, die Instanzen tauschten
 * nichts aus; nach der Wiederkehr speicherte jede ihren eigenen Stand, und
 * der zuletzt speichernde ueberschrieb den anderen (Kriterium 1 und 2).
 * Das Laden von Editor 3 wartete bis zur Wiederkehr (Kriterium 6), und
 * ohne Abgleich nach dem Wiederverbinden zeigte kein Editor die Tokens des
 * anderen (Kriterium 3).
 *
 * Dass beide Editoren danach alle Tokens zeigen, besorgt in Fall 1a
 * schon das Zusammenfuehren: B uebernimmt beim Speichern nach der
 * Wiederkehr den Stand von A, und diese Aenderung schickt die Erweiterung
 * als Sync-Schritt an A, das mit seinem Stand antwortet. Den Abgleich
 * nach dem Wiederverbinden allein prueft Fall 1c.
 *
 * Fall 1c, Redis 30 s weg, nur Editor 1 tippt, von 0 bis 20 s. Seine
 * Veroeffentlichungen scheitern im Ausfall (die letzte lehnt ioredis
 * spaetestens bei der naechsten Ablehnung der Warteschlange ab, lange vor
 * 30 s), B speichert nichts, es gibt nichts zusammenzufuehren. 30 s:
 * starten, Tippende. Ohne Abgleich nach dem Wiederverbinden zeigte
 * Editor 2 die Tokens von Editor 1 nie (Kriterium 3).
 *
 * Fall 1b, Redis 30 s weg, Editor 2 trennt bei 10 s. Sein Speicherlauf
 * faellt sicher in den Ausfall: frueher scheiterte Redlock nach 0 bis 3 s
 * (naechste Ablehnung der Warteschlange), Hocuspocus verwarf den Lauf und
 * entlud das Dokument lange vor der Wiederkehr. B's Tokens fehlten dann
 * ueberall, auch nachdem A wieder speicherte.
 *
 * Fall 2, Redis 30 s voll. Schreibende Befehle scheitern sofort mit OOM,
 * PUBLISH und SUBSCRIBE laufen weiter: die Editoren sehen sich live. 20 s:
 * Tippende; beide Editoren zeigen alle Tokens (Kriterium 3), dann trennen
 * beide. Frueher scheiterte Redlock beim Speichern an OOM, und der Lauf
 * beim Trennen wurde verworfen: nichts aus dem Fenster "voll" stand danach
 * in der Datenbank. 30 s: voll(false).
 *
 * Fall 3, Neustart beim Tippen: 5 s tippen, redis-server anhalten und
 * starten (wie `docker compose restart redis`), 5 s weiter tippen. Ob
 * frueher eine unbehandelte Ablehnung eine Instanz beendete (Kriterium 4),
 * hing am Zeitpunkt; den festen Beleg dafuer liefert
 * apps/collab/src/redis-client.test.ts.
 *
 * Fall 0, getrennte Instanzen: A an einem Redis, C an einem zweiten; sie
 * gleichen nie ueber Redis ab. Je ein Editor tippt 10 Tokens, beide
 * trennen. Nur das Zusammenfuehren beim Speichern bringt beide Staende in
 * die Datenbank (Kriterium 1 und 2).
 *
 * Braucht redis-server 7 oder neuer im PATH (./redis-privat). Lokal ohne
 * uebersprungen, in der CI (CI gesetzt) ein Fehler.
 */

const TAKT_MS = 200;
const ABGLEICH_MS = 30_000;
/**
 * Kriterium 6. Anmelden und Laden gehen waehrend eines bekannten
 * Ausfalls ohne Warten an Redis vorbei, nur der Ticketverbrauch wartet
 * weiter auf Redis (bis zur naechsten Ablehnung der Warteschlange, 0 bis
 * 3 s; ein kurzer Wackler soll kein Ticket zweimal gueltig machen).
 * Ohne den Schnellweg warteten drei Befehle nacheinander, 6 bis 9 s.
 */
const GRENZE_NEUE_VERBINDUNG_MS = 5_000;
const VERBOTEN = [
  "Unbehandelte Ablehnung",
  "Unbehandelter Fehler",
  "Speicherlauf gescheitert",
];

const vorhanden = redisServerVorhanden();
if (!vorhanden && process.env.CI) {
  throw new Error(
    "redis-server 7 oder neuer fehlt im PATH; die CI installiert es im Job e2e",
  );
}
if (!vorhanden) {
  process.stdout.write(
    "collab-chaos.test.ts uebersprungen: redis-server 7 oder neuer fehlt im PATH (CONTRIBUTING, Local test prerequisites)\n",
  );
}

const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Konto = { id: string; sessionId: string };
let owner: Konto;
let member: Konto;
let spaceId: string;
let epoche: string | null;

/** Was ein Fall startet; afterEach raeumt es weg. */
let redisse: EigenesRedis[] = [];
let server: Pruefserver[] = [];
let providers: HocuspocusProvider[] = [];

async function konto(name: string, role: "OWNER" | "MEMBER"): Promise<Konto> {
  const u = await prisma.user.create({
    data: { email: `${TAG}-${name}@example.test`, name, passwordHash: "x" },
    select: { id: true },
  });
  const s = await prisma.session.create({
    data: { userId: u.id, expiresAt: new Date(Date.now() + 3_600_000) },
    select: { id: true },
  });
  await prisma.spaceMember.create({ data: { spaceId, userId: u.id, role } });
  return { id: u.id, sessionId: s.id };
}

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

function ticket(k: Konto, pageId: string) {
  return () =>
    issueCollabTicket({
      userId: k.id,
      tokenVersion: 0,
      sessionId: k.sessionId,
      pageId,
      restoreEpoch: epoche,
    });
}

async function redisServer(): Promise<EigenesRedis> {
  const r = await starteEigenesRedis();
  redisse.push(r);
  return r;
}

async function instanz(redisUrl: string): Promise<Pruefserver> {
  const s = await startePruefserver({ redisUrl, appSecret: getAppSecret() });
  server.push(s);
  return s;
}

async function editor(s: Pruefserver, k: Konto, pageId: string) {
  const v = await verbinde({ url: s.url, pageId, ticket: ticket(k, pageId) });
  providers.push(v.provider);
  return v;
}

/** Tippt alle TAKT_MS einen Absatz `<praefix>-<n>` ans Ende. */
function tipper(doc: Y.Doc, praefix: string) {
  const tokens: string[] = [];
  const timer = setInterval(() => {
    const token = `${praefix}-${tokens.length + 1}`;
    tippe(doc, token);
    tokens.push(token);
  }, TAKT_MS);
  return { tokens, stop: () => clearInterval(timer) };
}

const imYjs = (text: string, token: string) => text.includes(`>${token}<`);
const imJson = (text: string, token: string) => text.includes(`"${token}"`);

/**
 * Kriterien 1 bis 3 bis ABGLEICH_MS nach dem Tippende; liefert die
 * Zeiten ab Tippende (null: nicht erreicht) und schreibt die JSON-Zeile.
 */
async function messe(
  fall: string,
  pageId: string,
  tippende: number,
  tokens: string[],
  verbunden: Y.Doc[],
  extra: Record<string, unknown> = {},
) {
  const bis: {
    collabDocument: number | null;
    pageContent: number | null;
    editoren: number | null;
  } = { collabDocument: null, pageContent: null, editoren: null };
  const ende = tippende + ABGLEICH_MS;
  while (Date.now() < ende) {
    const t = Date.now() - tippende;
    if (bis.collabDocument === null) {
      const text = await textImCollabDocument(pageId);
      if (tokens.every((tok) => imYjs(text, tok))) bis.collabDocument = t;
    }
    if (bis.pageContent === null) {
      const text = await textInPageContent(pageId);
      if (tokens.every((tok) => imJson(text, tok))) bis.pageContent = t;
    }
    if (
      bis.editoren === null &&
      verbunden.every((doc) => tokens.every((tok) => imYjs(inhalt(doc), tok)))
    ) {
      bis.editoren = t;
    }
    if (Object.values(bis).every((v) => v !== null)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  // Eine Zeile je Fall im Log der CI (Trend der Zeiten). Direkt auf
  // stdout: Vitest zeigt console.* nur bei scheiternden Tests.
  process.stdout.write(
    `${JSON.stringify({ chaos: fall, tokens: tokens.length, msBis: bis, ...extra })}\n`,
  );
  return bis;
}

/** Kriterien 4 und 5. */
function prozesseHeil(vorher: { s: Pruefserver; pid: number }[]) {
  for (const { s, pid } of vorher) {
    expect(s.laeuft(), `Collab-Prozess ${pid} beendet:\n${s.log()}`).toBe(true);
    expect(s.pid).toBe(pid);
    for (const text of VERBOTEN) {
      expect(s.log(), `Log von ${pid}`).not.toContain(text);
    }
  }
}

function fehlend(text: string, tokens: string[], pruefe = imYjs): string[] {
  return tokens.filter((tok) => !pruefe(text, tok));
}

beforeAll(async () => {
  if (!vorhanden) return;
  epoche = await currentRestoreEpoch(prisma);
  spaceId = (
    await prisma.space.create({
      data: { name: TAG, slug: TAG },
      select: { id: true },
    })
  ).id;
  owner = await konto("owner", "OWNER");
  member = await konto("member", "MEMBER");
}, 60_000);

afterEach(async () => {
  for (const p of providers) p.destroy();
  providers = [];
  for (const s of server) await s.stop();
  server = [];
  for (const r of redisse) await r.beenden();
  redisse = [];
}, 60_000);

afterAll(async () => {
  if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}, 30_000);

describe.skipIf(!vorhanden)("Collab-Server bei Redis-Stoerungen", () => {
  it("Fall 0: getrennte Instanzen fuehren beim Speichern zusammen", async () => {
    const r1 = await redisServer();
    const r2 = await redisServer();
    const a = await instanz(r1.url);
    const c = await instanz(r2.url);
    const pids = [
      { s: a, pid: a.pid },
      { s: c, pid: c.pid },
    ];
    const pageId = await neueSeite("fall-0");
    const e1 = await editor(a, owner, pageId);
    const e2 = await editor(c, member, pageId);

    const t1 = tipper(e1.doc, "f0-1");
    const t2 = tipper(e2.doc, "f0-2");
    await warteBis(
      () => t1.tokens.length >= 10 && t2.tokens.length >= 10,
      "je 10 Tokens",
    );
    t1.stop();
    t2.stop();
    e1.provider.destroy();
    e2.provider.destroy();
    const tippende = Date.now();
    const tokens = [...t1.tokens, ...t2.tokens];

    const bis = await messe("0", pageId, tippende, tokens, []);
    expect(
      fehlend(await textImCollabDocument(pageId), tokens),
      "Tokens fehlen in CollabDocument",
    ).toEqual([]);
    expect(
      fehlend(await textInPageContent(pageId), tokens, imJson),
      "Tokens fehlen in Page.content",
    ).toEqual([]);
    expect(bis.collabDocument).not.toBeNull();
    prozesseHeil(pids);
  }, 120_000);

  it("Fall 1a: Redis 30 s weg, beide bleiben verbunden", async () => {
    const r = await redisServer();
    const a = await instanz(r.url);
    const b = await instanz(r.url);
    const pids = [
      { s: a, pid: a.pid },
      { s: b, pid: b.pid },
    ];
    const pageId = await neueSeite("fall-1a");
    const ungeladen = await neueSeite("fall-1a-neu");
    const e1 = await editor(a, owner, pageId);
    const e2 = await editor(b, member, pageId);

    await r.anhalten();
    const beginn = Date.now();
    const t1 = tipper(e1.doc, "f1a-1");
    const t2 = tipper(e2.doc, "f1a-2");

    // Kriterium 6: 10 s nach Beginn eine neue Verbindung.
    await new Promise((res) => setTimeout(res, 10_000 - (Date.now() - beginn)));
    const abgewiesen: string[] = [];
    let synchron = false;
    const start3 = Date.now();
    const p3 = new HocuspocusProvider({
      url: a.url,
      name: ungeladen,
      document: new Y.Doc(),
      token: ticket(owner, ungeladen),
      onSynced: () => {
        synchron = true;
      },
      onAuthenticationFailed: ({ reason }) => {
        abgewiesen.push(reason);
      },
    });
    providers.push(p3);
    await warteBis(() => synchron || abgewiesen.length > 0, "Editor 3", {
      timeoutMs: 25_000,
      log: a.log,
    });
    const neuMs = Date.now() - start3;

    await new Promise((res) => setTimeout(res, 30_000 - (Date.now() - beginn)));
    t1.stop();
    t2.stop();
    await r.starten();
    const tippende = Date.now();
    const tokens = [...t1.tokens, ...t2.tokens];

    const bis = await messe("1a", pageId, tippende, tokens, [e1.doc, e2.doc], {
      neueVerbindungMs: neuMs,
    });
    expect(abgewiesen, "Editor 3 abgewiesen").toEqual([]);
    expect(neuMs, "Editor 3 synchronisiert").toBeLessThan(
      GRENZE_NEUE_VERBINDUNG_MS,
    );
    expect(
      fehlend(await textImCollabDocument(pageId), tokens),
      "Tokens fehlen in CollabDocument",
    ).toEqual([]);
    expect(
      fehlend(await textInPageContent(pageId), tokens, imJson),
      "Tokens fehlen in Page.content",
    ).toEqual([]);
    expect(
      fehlend(inhalt(e1.doc), tokens),
      "Tokens fehlen bei Editor 1",
    ).toEqual([]);
    expect(
      fehlend(inhalt(e2.doc), tokens),
      "Tokens fehlen bei Editor 2",
    ).toEqual([]);
    expect(bis.editoren).not.toBeNull();
    prozesseHeil(pids);
  }, 150_000);

  it("Fall 1c: Redis 30 s weg, nur Editor 1 tippt, Abgleich nach der Wiederkehr", async () => {
    const r = await redisServer();
    const a = await instanz(r.url);
    const b = await instanz(r.url);
    const pids = [
      { s: a, pid: a.pid },
      { s: b, pid: b.pid },
    ];
    const pageId = await neueSeite("fall-1c");
    const e1 = await editor(a, owner, pageId);
    const e2 = await editor(b, member, pageId);

    await r.anhalten();
    const beginn = Date.now();
    const t1 = tipper(e1.doc, "f1c-1");
    await new Promise((res) => setTimeout(res, 20_000 - (Date.now() - beginn)));
    t1.stop();
    await new Promise((res) => setTimeout(res, 30_000 - (Date.now() - beginn)));
    // Bis hier hat Editor 2 nichts davon gesehen.
    expect(t1.tokens.some((tok) => imYjs(inhalt(e2.doc), tok))).toBe(false);
    await r.starten();
    const tippende = Date.now();
    const tokens = t1.tokens;

    const bis = await messe("1c", pageId, tippende, tokens, [e1.doc, e2.doc]);
    expect(
      fehlend(await textImCollabDocument(pageId), tokens),
      "Tokens fehlen in CollabDocument",
    ).toEqual([]);
    expect(
      fehlend(await textInPageContent(pageId), tokens, imJson),
      "Tokens fehlen in Page.content",
    ).toEqual([]);
    expect(
      fehlend(inhalt(e2.doc), tokens),
      "Tokens fehlen bei Editor 2",
    ).toEqual([]);
    expect(bis.editoren).not.toBeNull();
    prozesseHeil(pids);
  }, 150_000);

  it("Fall 1b: Redis 30 s weg, Editor 2 trennt im Ausfall", async () => {
    const r = await redisServer();
    const a = await instanz(r.url);
    const b = await instanz(r.url);
    const pids = [
      { s: a, pid: a.pid },
      { s: b, pid: b.pid },
    ];
    const pageId = await neueSeite("fall-1b");
    const e1 = await editor(a, owner, pageId);
    const e2 = await editor(b, member, pageId);

    await r.anhalten();
    const beginn = Date.now();
    const t1 = tipper(e1.doc, "f1b-1");
    const t2 = tipper(e2.doc, "f1b-2");
    await new Promise((res) => setTimeout(res, 10_000 - (Date.now() - beginn)));
    t2.stop();
    e2.provider.destroy();

    await new Promise((res) => setTimeout(res, 30_000 - (Date.now() - beginn)));
    t1.stop();
    await r.starten();
    const tippende = Date.now();
    const tokens = [...t1.tokens, ...t2.tokens];

    const bis = await messe("1b", pageId, tippende, tokens, [e1.doc]);
    expect(
      fehlend(await textImCollabDocument(pageId), tokens),
      "Tokens fehlen in CollabDocument",
    ).toEqual([]);
    expect(
      fehlend(await textInPageContent(pageId), tokens, imJson),
      "Tokens fehlen in Page.content",
    ).toEqual([]);
    expect(
      fehlend(inhalt(e1.doc), tokens),
      "Tokens fehlen bei Editor 1",
    ).toEqual([]);
    expect(bis.editoren).not.toBeNull();
    prozesseHeil(pids);
  }, 150_000);

  it("Fall 2: Redis 30 s voll, beide trennen im Fenster", async () => {
    const r = await redisServer();
    const a = await instanz(r.url);
    const b = await instanz(r.url);
    const pids = [
      { s: a, pid: a.pid },
      { s: b, pid: b.pid },
    ];
    const pageId = await neueSeite("fall-2");
    const e1 = await editor(a, owner, pageId);
    const e2 = await editor(b, member, pageId);

    await r.voll(true);
    const beginn = Date.now();
    const t1 = tipper(e1.doc, "f2-1");
    const t2 = tipper(e2.doc, "f2-2");
    await new Promise((res) => setTimeout(res, 20_000 - (Date.now() - beginn)));
    t1.stop();
    t2.stop();
    const tokens = [...t1.tokens, ...t2.tokens];
    // Kriterium 3 vor dem Trennen: im Fenster "voll" gleichen die
    // Instanzen weiter ueber Redis ab.
    await warteBis(
      () =>
        [e1.doc, e2.doc].every((doc) =>
          tokens.every((tok) => imYjs(inhalt(doc), tok)),
        ),
      "beide Editoren zeigen alle Tokens",
      { timeoutMs: 10_000 },
    );
    e1.provider.destroy();
    e2.provider.destroy();
    const tippende = Date.now();

    const bis = await messe("2", pageId, tippende, tokens, []);
    expect(
      fehlend(await textImCollabDocument(pageId), tokens),
      "Tokens fehlen in CollabDocument",
    ).toEqual([]);
    expect(
      fehlend(await textInPageContent(pageId), tokens, imJson),
      "Tokens fehlen in Page.content",
    ).toEqual([]);
    // Gespeichert, waehrend Redis noch voll war.
    expect(bis.collabDocument).not.toBeNull();
    expect(tippende - beginn + bis.collabDocument!).toBeLessThan(30_000);
    await new Promise((res) =>
      setTimeout(res, Math.max(0, 30_000 - (Date.now() - beginn))),
    );
    await r.voll(false);
    prozesseHeil(pids);
  }, 150_000);

  it("Fall 3: Neustart von Redis beim Tippen", async () => {
    const r = await redisServer();
    const a = await instanz(r.url);
    const b = await instanz(r.url);
    const pids = [
      { s: a, pid: a.pid },
      { s: b, pid: b.pid },
    ];
    const pageId = await neueSeite("fall-3");
    const e1 = await editor(a, owner, pageId);
    const e2 = await editor(b, member, pageId);

    const t1 = tipper(e1.doc, "f3-1");
    const t2 = tipper(e2.doc, "f3-2");
    await new Promise((res) => setTimeout(res, 5_000));
    await r.neuStarten();
    await new Promise((res) => setTimeout(res, 5_000));
    t1.stop();
    t2.stop();
    const tippende = Date.now();
    const tokens = [...t1.tokens, ...t2.tokens];

    const bis = await messe("3", pageId, tippende, tokens, [e1.doc, e2.doc]);
    expect(
      fehlend(await textImCollabDocument(pageId), tokens),
      "Tokens fehlen in CollabDocument",
    ).toEqual([]);
    expect(
      fehlend(await textInPageContent(pageId), tokens, imJson),
      "Tokens fehlen in Page.content",
    ).toEqual([]);
    expect(
      fehlend(inhalt(e1.doc), tokens),
      "Tokens fehlen bei Editor 1",
    ).toEqual([]);
    expect(
      fehlend(inhalt(e2.doc), tokens),
      "Tokens fehlen bei Editor 2",
    ).toEqual([]);
    expect(bis.editoren).not.toBeNull();
    prozesseHeil(pids);
  }, 120_000);
});
