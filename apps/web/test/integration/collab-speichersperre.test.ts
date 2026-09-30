import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import pg from "pg";
import { currentRestoreEpoch, prisma } from "@dokunc/db";
import {
  SPERR_PRAEFIX,
  SPERR_VERBINDUNGEN,
  SperreNichtErhalten,
  createStoreLock,
} from "../../../collab/src/store-lock";
import { startePruefserver, type Pruefserver } from "./collab-pruefserver";
import {
  textImCollabDocument,
  textInPageContent,
  tippe,
  verbinde,
  warteBis,
} from "./collab-hilfen";

/**
 * Die Speichersperre des Collab-Servers (apps/collab/src/store-lock.ts)
 * gegen die echte Datenbank, mit einem eigenen Pool wie im
 * Collab-Prozess. Jeder Fall nutzt eigene Seiten-IDs: die Sperren gelten
 * fuer die ganze Datenbank.
 *
 * Der letzte Block laesst einen echten Collab-Server (eigener Prozess,
 * Redis-Datenbank 1, siehe ./collab-pruefserver) die Verbindung seiner
 * Sperre mitten im Speicherlauf verlieren.
 */

const REDIS_DB = 1;
const { issueCollabTicket } = await import("@/lib/collab-ticket");
const { getAppSecret } = await import("@/lib/secret");

const TAG = `sperre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: SPERR_VERBINDUNGEN,
});
/** Fuer pg_locks und pg_terminate_backend, neben dem Pool der Sperre. */
const admin = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
});

afterAll(async () => {
  await pool.end();
  await admin.end();
});

/**
 * Prozess-ID der Verbindung, die die Sperre der Seite haelt (mit
 * `wartend`: die auf sie wartet); null ohne.
 */
async function sperrHalter(
  pageId: string,
  wartend = false,
): Promise<number | null> {
  const r = await admin.query<{ pid: number }>(
    `SELECT pid FROM pg_locks
      WHERE locktype = 'advisory' AND granted = $2 AND objsubid = 1
        AND ((classid::bigint << 32) | objid::bigint) = hashtextextended($1, 0)`,
    [`${SPERR_PRAEFIX}${pageId}`, !wartend],
  );
  return r.rows[0]?.pid ?? null;
}

/**
 * Die Verbindung beenden, die die Sperre der Seite haelt, wie es ein
 * Neustart der Datenbank, ein Failover oder PgBouncer tut.
 */
async function reisseSperreAb(pageId: string): Promise<void> {
  const pid = await sperrHalter(pageId);
  if (pid === null) throw new Error(`Keine Sperre fuer ${pageId}`);
  await admin.query("SELECT pg_terminate_backend($1)", [pid]);
}

/** Versprechen samt Ausloeser, fuer eine Schranke im Lauf. */
function schranke() {
  let oeffne!: () => void;
  const offen = new Promise<void>((r) => (oeffne = r));
  return { offen, oeffne };
}

describe("Speichersperre je Seite in Postgres", () => {
  it("laesst einen zweiten Lauf derselben Seite warten, einen fuer eine andere Seite nicht", async () => {
    const mitSperre = createStoreLock(pool);
    const x = `${TAG}-x`;
    const y = `${TAG}-y`;
    const beginn: Record<string, number> = {};
    const s1 = schranke();
    const imLauf1 = schranke();

    const lauf1 = mitSperre(x, async () => {
      beginn.lauf1 = Date.now();
      imLauf1.oeffne();
      await s1.offen;
    });
    await imLauf1.offen;
    const start = Date.now();
    const lauf2 = mitSperre(x, async () => {
      beginn.lauf2 = Date.now();
    });
    const lauf3 = mitSperre(y, async () => {
      beginn.lauf3 = Date.now();
    });

    await lauf3;
    await new Promise((r) => setTimeout(r, 300));
    // Die Sperre auf X haelt Y nicht auf, aber den zweiten Lauf fuer X.
    expect(beginn.lauf3 - start).toBeLessThan(300);
    expect(beginn.lauf2).toBeUndefined();

    s1.oeffne();
    await Promise.all([lauf1, lauf2]);
    expect(beginn.lauf2).toBeGreaterThanOrEqual(start + 300);
  });

  // Die echte Fehlerform von Postgres (ueber pg), nicht die Attrappe des
  // Unit-Tests: lock_timeout liefert 55P03, und der Lauf beginnt nie.
  it("gibt nach der Wartezeit mit der Seite auf, wenn eine andere Instanz die Sperre haelt", async () => {
    const z = `${TAG}-z`;
    const halter = createStoreLock(pool);
    const wartend = createStoreLock(pool, { sperreWartenMs: 200 });
    const s = schranke();
    const imLauf = schranke();
    const gehalten = halter(z, async () => {
      imLauf.oeffne();
      await s.offen;
    });
    await imLauf.offen;
    let gelaufen = false;
    const vorher = Date.now();
    const fehler = await wartend(z, async () => {
      gelaufen = true;
    }).catch((e: unknown) => e);
    const gewartet = Date.now() - vorher;
    s.oeffne();
    await gehalten;

    expect(fehler).toBeInstanceOf(SperreNichtErhalten);
    expect((fehler as Error).message).toBe(
      `Speichersperre fuer Seite ${z} nicht erhalten`,
    );
    expect(((fehler as Error).cause as { code?: string }).code).toBe("55P03");
    expect(gelaufen).toBe(false);
    expect(gewartet).toBeGreaterThanOrEqual(150);
    expect(gewartet).toBeLessThan(5_000);
    // Die Verbindung ging heil in den Pool zurueck: der naechste Lauf
    // bekommt die Sperre.
    await expect(wartend(z, async () => "danach")).resolves.toBe("danach");
  });

  // pg meldet den Abriss als "error" am Client, ausserhalb jedes
  // Befehls. Ohne Hoerer waehrend der Leihe endete der Prozess, hier der
  // Testlauf ("Unhandled Errors").
  it("ueberlebt den Abriss der Verbindung mitten im Lauf, laesst den Lauf scheitern und gibt die Sperre frei", async () => {
    const v = `${TAG}-v`;
    const abrisse: [string, unknown][] = [];
    const mitSperre = createStoreLock(pool, {
      onAbriss: (pageId, e) => abrisse.push([pageId, e]),
    });
    const fehler = await mitSperre(v, async () => {
      await reisseSperreAb(v);
      await warteBis(() => abrisse.length > 0, "Abriss gemeldet");
      return "geschrieben";
    }).catch((e: unknown) => e);

    expect(fehler).toBeInstanceOf(Error);
    expect((fehler as Error).message).toBe(
      `Speichersperre fuer Seite ${v} verloren`,
    );
    expect(((fehler as Error).cause as { code?: string }).code).toBe("57P01");
    expect(abrisse.map(([pageId]) => pageId)).toEqual([v]);
    expect(await sperrHalter(v)).toBeNull();
    // Der Pool hat die tote Verbindung verworfen; der naechste Lauf
    // bekommt eine neue und die Sperre.
    await expect(mitSperre(v, async () => "danach")).resolves.toBe("danach");
  });

  // Beim Warten scheitert zuerst der wartende Befehl (57P01), dann meldet
  // pg das Ende des Sockets als "error" am Client.
  it("ueberlebt den Abriss der Verbindung waehrend des Wartens auf die Sperre", async () => {
    const u = `${TAG}-u`;
    const halter = createStoreLock(pool);
    const abrisse: string[] = [];
    const wartend = createStoreLock(pool, {
      onAbriss: (pageId) => abrisse.push(pageId),
    });
    const s = schranke();
    const imLauf = schranke();
    const gehalten = halter(u, async () => {
      imLauf.oeffne();
      await s.offen;
    });
    await imLauf.offen;
    let gelaufen = false;
    const ergebnis = wartend(u, async () => {
      gelaufen = true;
    }).catch((e: unknown) => e);
    await warteBis(
      async () => (await sperrHalter(u, true)) !== null,
      "Lauf wartet auf die Sperre",
    );
    await admin.query("SELECT pg_terminate_backend($1)", [
      await sperrHalter(u, true),
    ]);
    const fehler = await ergebnis;
    s.oeffne();
    await gehalten;

    expect(fehler).toBeInstanceOf(Error);
    expect(fehler).not.toBeInstanceOf(SperreNichtErhalten);
    expect((fehler as { code?: string }).code).toBe("57P01");
    expect(gelaufen).toBe(false);
    expect(abrisse).toEqual([u]);
    await expect(wartend(u, async () => "danach")).resolves.toBe("danach");
  });

  it("gibt die Sperre frei, wenn der Lauf scheitert", async () => {
    const w = `${TAG}-w`;
    const mitSperre = createStoreLock(pool, { sperreWartenMs: 2_000 });
    await expect(
      mitSperre(w, async () => {
        throw new Error("Lauf gescheitert");
      }),
    ).rejects.toThrow("Lauf gescheitert");
    await expect(mitSperre(w, async () => "frei")).resolves.toBe("frei");
  });
});

describe("Collab-Server, wenn die Datenbank die Verbindung der Sperre abreisst", () => {
  let collab: Pruefserver | null = null;
  let providers: HocuspocusProvider[] = [];
  let userId: string;
  let sessionId: string;
  let spaceId: string;
  let epoche: string | null;

  beforeAll(async () => {
    collab = await startePruefserver({
      redisDb: REDIS_DB,
      appSecret: getAppSecret(),
      exklusiv: true,
    });
    epoche = await currentRestoreEpoch(prisma);
    userId = (
      await prisma.user.create({
        data: {
          email: `${TAG}@example.test`,
          name: "Sperre",
          passwordHash: "x",
        },
        select: { id: true },
      })
    ).id;
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

  afterAll(async () => {
    for (const p of providers) p.destroy();
    providers = [];
    await collab?.stop();
    if (spaceId) await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  }, 30_000);

  // Vorher endete der Prozess mit "Unbehandelter Fehler, Collab-Server
  // beendet sich" (57P01), und mit ihm alles, was er noch im Speicher
  // hatte.
  it("laeuft weiter, laesst den Lauf scheitern und speichert mit dem naechsten", async () => {
    const server = collab!;
    const pageId = (
      await prisma.page.create({
        data: {
          spaceId,
          title: `${TAG}-seite`,
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
    const editor = await verbinde({
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
    });
    providers.push(editor.provider);
    await warteBis(
      async () =>
        !!(await prisma.collabDocument.findUnique({ where: { pageId } })),
      "Zeile angelegt",
      { log: server.log },
    );

    // Den Lauf in seiner Sperre festhalten: die Seitenzeile ist gesperrt,
    // also wartet er beim Schreiben von Page.content.
    const halter = await admin.connect();
    try {
      await halter.query("BEGIN");
      await halter.query('SELECT id FROM "Page" WHERE id = $1 FOR UPDATE', [
        pageId,
      ]);
      tippe(editor.doc, "Eins");
      await warteBis(
        async () => (await sperrHalter(pageId)) !== null,
        "Speicherlauf haelt die Sperre",
        { log: server.log },
      );
      await reisseSperreAb(pageId);
      await warteBis(
        () =>
          server
            .log()
            .includes(
              "Speichersperre: Verbindung waehrend des Speicherlaufs abgerissen",
            ),
        "Abriss gemeldet",
        { log: server.log },
      );
    } finally {
      await halter.query("COMMIT");
      halter.release();
    }

    await warteBis(
      () => server.log().includes("Speicherlauf gescheitert"),
      "Lauf gescheitert",
      { log: server.log },
    );
    const zeile = server
      .log()
      .split("\n")
      .find((z) => z.includes("Speicherlauf gescheitert"));
    expect(zeile).toContain(pageId);
    expect(zeile).toContain(`Speichersperre fuer Seite ${pageId} verloren`);
    expect(server.laeuft()).toBe(true);
    expect(server.log()).not.toContain("Unbehandelte");
    expect(server.log()).not.toContain("Unbehandelter");

    // Der naechste Lauf nimmt eine neue Verbindung und speichert.
    tippe(editor.doc, "Zwei");
    await warteBis(
      async () => (await textInPageContent(pageId)).includes("Zwei"),
      "Zwei in Page.content",
      { log: server.log },
    );
    expect(await textImCollabDocument(pageId)).toContain("Zwei");
    expect(await textImCollabDocument(pageId)).toContain("Eins");
    expect(server.laeuft()).toBe(true);
  }, 60_000);
});
