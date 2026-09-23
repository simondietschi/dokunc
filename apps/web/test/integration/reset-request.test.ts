import { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { prisma } from "@dokunc/db";
import { log } from "@/lib/log";
import { rateLimit, releaseLimit } from "@/lib/rate-limit";

/**
 * Passwort-Reset, wenn der Mailversand scheitert.
 *
 * Nach aussen darf sich nichts aendern: dieselbe Antwort wie bei einer
 * unbekannten Adresse, sonst verriete das Formular, welche Konten es
 * gibt. Innen soll der Fehler im Log stehen (ohne Adresse, ohne Link).
 * Nur bei einem voruebergehenden Fehler (Server nicht erreichbar, 4xx)
 * kommt der Platz der Bremse pro Konto zurueck, damit nach einem
 * SMTP-Ausfall der naechste Versuch nicht eine Stunde lang an der
 * Bremse haengt. Eine dauerhafte Ablehnung zaehlt weiter, ebenso ein
 * Betrieb ohne SMTP. Die Bremse pro IP bleibt immer verbraucht.
 *
 * Echte Datenbank und echtes Redis; ersetzt sind nur der Mailversand
 * und die Anfrage-Header (fuer eine eigene IP je Test). Fuer den einen
 * Fall, dass die Datenbank nach dem Versand streikt, reicht ein Schalter
 * einen Fehler durch — die Delegates des Clients lassen sich nicht
 * direkt bespitzeln.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn<(opts: { to: string; resetUrl: string }) => Promise<boolean>>(),
  ip: "",
  /** Naechstes passwordResetToken.updateMany wirft (einmalig). */
  failUpdateMany: false,
}));

vi.mock("@dokunc/db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@dokunc/db")>();
  const prisma = new Proxy(orig.prisma, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "passwordResetToken" || !mocks.failUpdateMany) return value;
      return new Proxy(value, {
        get(delegate, method) {
          if (method === "updateMany") {
            mocks.failUpdateMany = false;
            return async () => {
              throw new Error("Verbindung weg");
            };
          }
          const v = Reflect.get(delegate, method);
          return typeof v === "function" ? v.bind(delegate) : v;
        },
      });
    },
  });
  return { ...orig, prisma };
});

vi.mock("@/lib/mail", async (importOriginal) => {
  // Die Einstufung der Fehler bleibt echt: sie ist ein Teil dessen, was
  // hier geprueft wird.
  const orig = await importOriginal<typeof import("@/lib/mail")>();
  return {
    isTransientMailError: orig.isTransientMailError,
    buildResetUrl: (id: string, token: string) =>
      `http://dokunc.test/reset/${id}?token=${token}`,
    sendPasswordResetEmail: mocks.send,
  };
});
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": mocks.ip })),
}));

const { requestResetAction } = await import("@/app/(auth)/reset/actions");

const TAG = `reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** Zufaelliges Mittelstueck: die IP-Zaehler leben 15 Minuten ueber den Lauf hinaus. */
const NET = `198.51.${Math.floor(Math.random() * 250)}`;
let ipCounter = 0;
const usedKeys: string[] = [];
const users: string[] = [];

let redis: Redis;
/** Haelt die Fehlerzeilen aus der Testausgabe und macht sie pruefbar. */
let logSpy: MockInstance<typeof log.error>;

function formular(email: string): FormData {
  const f = new FormData();
  f.set("email", email);
  return f;
}

/** Neue IP fuer den naechsten Test: die IP-Bremse erlaubt fuenf Anfragen. */
function neueIp(): string {
  ipCounter += 1;
  mocks.ip = `${NET}.${ipCounter}`;
  usedKeys.push(`dokunc:rl:reset-req:${mocks.ip}`);
  return mocks.ip;
}

async function konto(name: string): Promise<{ id: string; email: string }> {
  const email = `${TAG}-${name}@example.test`;
  const user = await prisma.user.create({
    data: { email, name, passwordHash: "x" },
    select: { id: true, email: true },
  });
  users.push(user.id);
  usedKeys.push(`dokunc:rl:reset:account:${email}`);
  return user;
}

async function links(userId: string) {
  return prisma.passwordResetToken.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, usedAt: true },
  });
}

/**
 * Dauerhafte Ablehnung, so wie nodemailer sie meldet: Code EENVELOPE,
 * Antwortcode 550, und der Server wiederholt den Empfaenger.
 */
function abgelehnt(email: string): Error {
  const response = `550 5.1.1 <${email}>: Recipient address rejected`;
  return Object.assign(
    new Error(`Can't send mail - all recipients were rejected: ${response}`),
    {
      code: "EENVELOPE",
      response,
      responseCode: 550,
      command: "RCPT TO",
      rejected: [email],
    },
  );
}

/** Server nicht erreichbar, wie nodemailer es meldet: voruebergehend. */
function nichtErreichbar(): Error {
  return Object.assign(new Error("Connection timeout"), {
    code: "ETIMEDOUT",
    command: "CONN",
  });
}

beforeAll(() => {
  // Ein eigener Proxy davor, damit X-Forwarded-For als Client-IP zaehlt
  // (lib/client-ip). Ohne ihn fielen alle Tests in denselben Topf.
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 1,
  });
});

beforeEach(() => {
  mocks.send.mockReset();
  mocks.failUpdateMany = false;
  logSpy = vi.spyOn(log, "error").mockImplementation(() => undefined);
  neueIp();
});

afterEach(() => {
  logSpy.mockRestore();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (usedKeys.length) await redis.del(...usedKeys);
  redis.disconnect();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("Passwort-Reset bei gescheitertem Mailversand", () => {
  it("antwortet genauso wie bei einer unbekannten Adresse", async () => {
    const user = await konto("same-answer");
    mocks.send.mockRejectedValue(abgelehnt(user.email));

    const bekannt = await requestResetAction(undefined, formular(user.email));
    const unbekannt = await requestResetAction(
      undefined,
      formular(`${TAG}-niemand@example.test`),
    );

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(bekannt).toEqual({ sent: true });
    expect(unbekannt).toEqual(bekannt);
  });

  it("gibt den Platz der Kontobremse zurück, wenn der Server nicht erreichbar war", async () => {
    const user = await konto("release");
    mocks.send.mockRejectedValue(nichtErreichbar());

    // Drei gescheiterte Versuche — so viele erlaubt die Bremse pro
    // Konto in einer Stunde.
    for (let i = 0; i < 3; i++) {
      expect(await requestResetAction(undefined, formular(user.email))).toEqual(
        { sent: true },
      );
    }
    expect(mocks.send).toHaveBeenCalledTimes(3);

    // Der SMTP-Server ist wieder da. Ohne die Rueckgabe hinge dieser
    // Versuch an der Bremse, obwohl nie eine Mail angekommen ist.
    mocks.send.mockReset();
    mocks.send.mockResolvedValue(true);
    expect(await requestResetAction(undefined, formular(user.email))).toEqual({
      sent: true,
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].to).toBe(user.email);

    const rows = await links(user.id);
    expect(rows).toHaveLength(4);
    expect(rows.slice(0, 3).every((r) => r.usedAt !== null)).toBe(true);
    expect(rows[3].usedAt).toBeNull();
  });

  it("eine dauerhafte Ablehnung zählt gegen die Kontobremse", async () => {
    const user = await konto("rejected");
    mocks.send.mockRejectedValue(abgelehnt(user.email));

    for (let i = 0; i < 4; i++) {
      expect(await requestResetAction(undefined, formular(user.email))).toEqual(
        { sent: true },
      );
    }
    // Der vierte Versuch haengt an der Bremse: kein SMTP-Versuch und kein
    // weiterer Eintrag. Gaebe die Ablehnung den Platz zurueck, liesse
    // sich fuer eine Adresse, die der Server immer abweist, unbegrenzt
    // anfragen — begrenzt nur noch pro IP.
    expect(mocks.send).toHaveBeenCalledTimes(3);
    const rows = await links(user.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.usedAt !== null)).toBe(true);
    expect(
      logSpy.mock.calls.filter((c) => c[1] === "reset mail failed"),
    ).toHaveLength(3);
  });

  it("ohne SMTP in der Produktion gilt der Versand als gescheitert", async () => {
    const user = await konto("no-smtp");
    // Ein Link, der noch vor dem Abschalten von SMTP hinausging.
    mocks.send.mockResolvedValueOnce(true);
    await requestResetAction(undefined, formular(user.email));
    // Jetzt kein SMTP: sendPasswordResetEmail wirft nicht, meldet aber,
    // dass der Link nirgends ankam (in der Produktion steht er auch
    // nicht im Log).
    mocks.send.mockResolvedValueOnce(false);
    expect(await requestResetAction(undefined, formular(user.email))).toEqual({
      sent: true,
    });

    const [frueher, ohneSmtp] = await links(user.id);
    // Der verschickte Link bleibt gueltig, der nie verschickte ist tot.
    expect(frueher.usedAt).toBeNull();
    expect(ohneSmtp.usedAt).not.toBeNull();
    const call = logSpy.mock.calls.find((c) => c[1] === "reset mail failed");
    const fields = call?.[0] as unknown as Record<string, unknown>;
    expect(fields).toMatchObject({
      err: "SMTP nicht eingerichtet",
      userId: user.id,
      resetId: ohneSmtp.id,
      released: false,
    });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(user.email);
    // Die Bremse bleibt verbraucht: ein fehlendes SMTP vergeht nicht von
    // selbst.
    expect(await redis.get(`dokunc:rl:reset:account:${user.email}`)).toBe("2");
  });

  it("erfolgreiche Versände zählen weiter", async () => {
    const user = await konto("counted");
    mocks.send.mockResolvedValue(true);

    for (let i = 0; i < 4; i++) {
      expect(await requestResetAction(undefined, formular(user.email))).toEqual(
        { sent: true },
      );
    }
    // Der vierte blieb an der Bremse haengen — und das ohne Unterschied
    // in der Antwort.
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it("die Bremse pro IP bleibt auch nach gescheitertem Versand verbraucht", async () => {
    const user = await konto("ip");
    // Voruebergehend, damit die Kontobremse jedes Mal zurueckgibt und
    // nur die Bremse pro IP uebrig bleibt.
    mocks.send.mockRejectedValue(nichtErreichbar());

    for (let i = 0; i < 5; i++) {
      expect(await requestResetAction(undefined, formular(user.email))).toEqual(
        { sent: true },
      );
    }
    expect(await requestResetAction(undefined, formular(user.email))).toEqual({
      error: "Zu viele Anfragen. Bitte später erneut.",
    });
    expect(mocks.send).toHaveBeenCalledTimes(5);
  });

  it("loggt Konto und Grund, aber weder Adresse noch Link", async () => {
    const user = await konto("log");
    // Grossgeschrieben, wie manche Server den Empfaenger zurueckgeben.
    mocks.send.mockRejectedValue(abgelehnt(user.email.toUpperCase()));

    await requestResetAction(undefined, formular(user.email));

    const call = logSpy.mock.calls.find((c) => c[1] === "reset mail failed");
    expect(call).toBeDefined();
    const fields = call?.[0] as unknown as Record<string, unknown>;
    expect(fields.userId).toBe(user.id);
    // Der Grund bleibt lesbar, nur die Adresse ist ersetzt.
    expect(String(fields.err)).toMatch(/Recipient address rejected/);
    expect(String(fields.err)).toContain("[adresse]");

    const token = new URL(
      mocks.send.mock.calls[0][0].resetUrl,
    ).searchParams.get("token");
    const text = JSON.stringify(logSpy.mock.calls);
    expect(text.toLowerCase()).not.toContain(user.email.toLowerCase());
    expect(token).toBeTruthy();
    expect(text).not.toContain(token);
  });

  it("der zuletzt verschickte Link bleibt gültig", async () => {
    const user = await konto("keep");
    mocks.send.mockResolvedValueOnce(true);
    await requestResetAction(undefined, formular(user.email));
    mocks.send.mockRejectedValueOnce(abgelehnt(user.email));
    await requestResetAction(undefined, formular(user.email));

    const [erster, zweiter] = await links(user.id);
    expect(erster.usedAt).toBeNull();
    expect(zweiter.usedAt).not.toBeNull();
  });

  it("ist die Mail draussen und scheitert nur das Entwerten, gilt der neue Link", async () => {
    const user = await konto("delivered");
    mocks.send.mockResolvedValue(true);
    mocks.failUpdateMany = true;

    expect(await requestResetAction(undefined, formular(user.email))).toEqual({
      sent: true,
    });

    // Der Schalter wurde verbraucht, das Entwerten ist also gescheitert.
    expect(mocks.failUpdateMany).toBe(false);
    expect(
      logSpy.mock.calls.some((c) => c[1] === "reset: older links not invalidated"),
    ).toBe(true);
    const [link] = await links(user.id);
    // Die Person hat genau diesen Link bekommen; entwertet waere er tot.
    expect(link.usedAt).toBeNull();
    // Und die Bremse bleibt verbraucht: es ging eine Mail hinaus.
    expect(await redis.get(`dokunc:rl:reset:account:${user.email}`)).toBe("1");
  });
});

describe("releaseLimit mit Redis", () => {
  const key = `${TAG}:release`;
  const full = `dokunc:rl:${key}`;

  beforeAll(() => {
    usedKeys.push(full, `dokunc:rl:${key}:leer`);
  });

  it("zieht einen Versuch ab und lässt den Ablauf stehen", async () => {
    expect(await rateLimit(key, 2, 600)).toBe(true);
    expect(await rateLimit(key, 2, 600)).toBe(true);
    await releaseLimit(key);
    expect(await redis.get(full)).toBe("1");
    const ttl = await redis.ttl(full);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
    expect(await rateLimit(key, 2, 600)).toBe(true);
    expect(await rateLimit(key, 2, 600)).toBe(false);
  });

  it("geht nicht unter null und legt keinen Schlüssel an", async () => {
    await redis.set(full, "1", "EX", 600);
    await releaseLimit(key);
    await releaseLimit(key);
    expect(await redis.get(full)).toBe("0");

    await releaseLimit(`${key}:leer`);
    expect(await redis.exists(`dokunc:rl:${key}:leer`)).toBe(0);
  });
});
