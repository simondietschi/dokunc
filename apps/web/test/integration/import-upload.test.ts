import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { Redis } from "ioredis";
import { prisma } from "@dokunc/db";

/**
 * Import: wer die Plaetze belegt, waehrend der Upload noch gelesen wird.
 *
 * Die Route nimmt ihre Plaetze, bevor sie den Upload liest. Vorher konnte
 * ein einzelnes Konto mit zwei Tabs oder zwei absichtlich langsamen
 * Uploads alle globalen Plaetze (Default 2) bis zum requestTimeout von
 * Node halten, und alle anderen Konten bekamen 429. Jetzt: hoechstens ein
 * laufender Import je Konto, und ein Upload, der zu langsam ankommt,
 * verliert seinen Platz.
 *
 * Echte Route, echte Datenbank, echtes Redis. Ersetzt sind Anmeldung,
 * Cache, Anfrage-Header und die Werte der Lesefrist (kurz statt 30 s).
 */

const hooks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  /** Werte der Lesefrist; die Route liest sie bei jeder Anfrage. */
  limits: { graceMs: 60_000, minBytesPerSecond: 1024 },
}));

vi.mock("@/lib/current-user", () => ({
  getCurrentUser: vi.fn(async () => hooks.user),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/import/upload-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/upload-read")>()),
  UPLOAD_READ_LIMITS: hooks.limits,
}));

const uploadDir = mkdtempSync(path.join(tmpdir(), "dokunc-import-upload-"));
process.env.UPLOAD_DIR = uploadDir;

const { POST } = await import("@/app/api/spaces/[id]/import/route");
const { log } = await import("@/lib/log");

const TAG = `impup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 1,
});

const users: string[] = [];
async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${users.length}@example.test`,
      name: `Test ${users.length}`,
      passwordHash: "x",
    },
    select: { id: true },
  });
  users.push(user.id);
  return user.id;
}

const spaces: string[] = [];
async function makeSpace(members: string[]): Promise<string> {
  const space = await prisma.space.create({
    data: {
      name: `${TAG}-${spaces.length}`,
      slug: `${TAG}-${spaces.length}`,
      members: { create: members.map((userId) => ({ userId, role: "ADMIN" as const })) },
    },
    select: { id: true },
  });
  spaces.push(space.id);
  return space.id;
}

/** Multipart-Koerper mit einem kleinen Markdown-Zip. */
async function formBody(): Promise<{ bytes: Uint8Array; contentType: string }> {
  const form = new FormData();
  const zip = zipSync({
    "Wiki/index.md": strToU8("# Wiki\n\n[Zu A](A.md)\n"),
    "Wiki/A.md": strToU8("# A\n"),
  });
  form.append("files", new File([new Uint8Array(zip)], "wiki.zip"));
  form.append("parentId", "");
  const encoded = new Response(form);
  return {
    bytes: new Uint8Array(await encoded.arrayBuffer()),
    contentType: encoded.headers.get("content-type")!,
  };
}

function request(
  spaceId: string,
  body: Uint8Array | ReadableStream<Uint8Array>,
  contentType: string,
  length: number,
): Request {
  return new Request(`${APP_URL}/api/spaces/${spaceId}/import`, {
    method: "POST",
    body,
    headers: {
      "content-type": contentType,
      "content-length": String(length),
      origin: APP_URL,
      host: new URL(APP_URL).host,
    },
    // Noetig fuer einen Strom als Koerper.
    duplex: "half",
  } as RequestInit);
}

async function send(
  userId: string,
  req: Request,
  spaceId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  hooks.user = { id: userId };
  const res = await POST(req, { params: Promise.resolve({ id: spaceId }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Ganzer Upload auf einmal. */
async function post(userId: string, spaceId: string) {
  const { bytes, contentType } = await formBody();
  return send(userId, request(spaceId, bytes, contentType, bytes.length), spaceId);
}

/**
 * Upload, der nach dem ersten Teil stehen bleibt. `lesend` erfuellt sich,
 * sobald die Route auf den Rest wartet — dann haelt sie ihre Plaetze.
 * `weiter()` schickt den Rest, `abgebrochen()` sagt, ob die Route das
 * Lesen abgebrochen hat.
 */
async function haltenderUpload(userId: string, spaceId: string) {
  const { bytes, contentType } = await formBody();
  const cut = bytes.length - 40;
  let weiter!: () => void;
  const rest = new Promise<void>((r) => (weiter = r));
  let lesend!: () => void;
  const wartet = new Promise<void>((r) => (lesend = r));
  let abgebrochen = false;
  let teil = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      teil += 1;
      if (teil === 1) {
        controller.enqueue(bytes.slice(0, cut));
        return;
      }
      lesend();
      await rest;
      if (abgebrochen) return;
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
    cancel() {
      abgebrochen = true;
    },
  });
  const antwort = send(userId, request(spaceId, stream, contentType, bytes.length), spaceId);
  return { antwort, wartet, weiter, abgebrochen: () => abgebrochen };
}

beforeEach(() => {
  hooks.limits.graceMs = 60_000;
  hooks.limits.minBytesPerSecond = 1024;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: { in: spaces } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await redis.del(...users.map((id) => `dokunc:rl:import:${id}:unknown`));
  redis.disconnect();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("Import: hoechstens ein laufender Import je Konto", () => {
  it("ein zweiter gleichzeitiger Import desselben Kontos bekommt 429, ein anderes Konto kommt durch", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const spaceId = await makeSpace([a, b]);

    // Konto A laedt hoch und haelt dabei seine Plaetze.
    const erster = await haltenderUpload(a, spaceId);
    await erster.wartet;

    const zweiter = await post(a, spaceId);
    expect(zweiter.status).toBe(429);
    expect(zweiter.body.error).toBe(
      "Es läuft bereits ein Import von dir. Bitte warte, bis er fertig ist, und versuche es dann erneut.",
    );
    // Abgewiesen vor der Bremse: A hat nur den einen Versuch verbraucht.
    expect(await redis.get(`dokunc:rl:import:${a}:unknown`)).toBe("1");

    // Konto B bekommt den zweiten globalen Platz (Default 2).
    const anderes = await post(b, spaceId);
    expect(anderes.status).toBe(200);
    expect(anderes.body.pages).toBe(2);

    erster.weiter();
    const fertig = await erster.antwort;
    expect(fertig.status).toBe(200);
    expect(fertig.body.pages).toBe(2);

    // Danach ist der Platz des Kontos wieder frei.
    expect(await redis.zcard(`dokunc:import:slots:konto:${a}`)).toBe(0);
    const danach = await post(a, spaceId);
    expect(danach.status).toBe(200);
  });
});

describe("Import: Frist fuer das Lesen des Uploads", () => {
  it("ein Upload, der stehen bleibt, verliert seine Plaetze nach der Frist", async () => {
    hooks.limits.graceMs = 300;
    hooks.limits.minBytesPerSecond = 1024;
    const warn = vi.spyOn(log, "warn");
    const a = await makeUser();
    const spaceId = await makeSpace([a]);

    const start = Date.now();
    const haengt = await haltenderUpload(a, spaceId);
    // Nie weiter(): ohne Frist wartete die Route bis zum requestTimeout.
    const res = await haengt.antwort;
    const dauer = Date.now() - start;

    expect(res.status).toBe(408);
    expect(res.body.error).toBe(
      "Der Upload kam zu langsam an und wurde abgebrochen. Bitte erneut versuchen, bei langsamer Verbindung in kleineren Teilen.",
    );
    // Anfangsfrist plus die Sekunden, die der erste Teil (gut 1 KB bei
    // 1 KiB/s) gutschreibt; weit unter den 300 s von Node.
    expect(dauer).toBeLessThan(10_000);
    expect(haengt.abgebrochen()).toBe(true);
    expect(warn).toHaveBeenCalledWith({ userId: a }, "Import: Upload zu langsam, abgebrochen");
    haengt.weiter();

    // Beide Plaetze sind wieder frei: derselbe Import kommt sofort durch.
    expect(await redis.zcard(`dokunc:import:slots:konto:${a}`)).toBe(0);
    const again = await post(a, spaceId);
    expect(again.status).toBe(200);
  });
});
