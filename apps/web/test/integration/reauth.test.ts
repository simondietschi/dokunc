import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";

/**
 * Bremse fuer die Bestaetigung mit dem aktuellen Passwort (Passwort
 * aendern, Konto loeschen, Zwei-Faktor abschalten, neue Codes).
 *
 * Vorher prueften die ersten beiden das Passwort ohne jede Bremse, die
 * TOTP-Aktionen je Aktion mit eigenem Zaehler, und kein Fehlversuch
 * stand im Audit. Aus einer kurz unbeaufsichtigten Sitzung liess sich das
 * Passwort so beliebig oft raten. Jetzt: ein Zaehler je Konto ueber alle
 * vier Stellen (10 in 10 Minuten), das Ende der Sitzung nach 10 falschen
 * Passwoertern in dieser Sitzung, und jeder Fehlversuch im Audit.
 *
 * Echte Datenbank und echtes Redis. Die Sitzung stammt aus einer echten
 * Session-Zeile, und wie im Betrieb gilt eine widerrufene Zeile nicht
 * mehr (requireUser leitet dann um). Ersetzt sind Cookie-Handhabung,
 * Cache und Anfrage-Header.
 */

const mocks = vi.hoisted(() => ({
  person: null as { id: string; sessionId: string } | null,
  destroySession: vi.fn(),
}));

class Umleitung extends Error {}

vi.mock("@/lib/current-user", async () => {
  const { prisma: db } = await import("@dokunc/db");
  async function requireUser() {
    const p = mocks.person;
    if (!p) throw new Umleitung("/login");
    const s = await db.session.findUnique({
      where: { id: p.sessionId },
      select: { revokedAt: true, user: { select: { id: true, email: true, name: true } } },
    });
    if (!s || s.revokedAt) throw new Umleitung("/login");
    return { ...s.user, isAdmin: false, tokenVersion: 0, sessionId: p.sessionId };
  }
  return { requireUser, getCurrentUser: requireUser };
});
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  createSession: vi.fn(),
  destroySession: mocks.destroySession,
  getSessionClaims: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Umleitung(url);
  }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "198.51.100.77" })),
}));

const { changePasswordAction, deleteAccountAction } = await import("@/app/account/actions");
const { disableTotpAction, regenerateRecoveryCodesAction } = await import(
  "@/app/account/totp-actions"
);
const { REAUTH_GEBREMST, REAUTH_SITZUNG_BEENDET } = await import("@/lib/reauth");
const { seal } = await import("@/lib/secret-box");
const { generateTotpSecret } = await import("@/lib/totp");

const TAG = `reauth-${Date.now()}-${randomBytes(3).toString("hex")}`;
const PASSWORT = "Richtig-und-lang-1";
const FALSCH = "falsch-falsch-falsch";
let hash: string;
const konten: string[] = [];
let redis: Redis;

type Konto = { id: string; sitzung: string; zweite: string };

async function konto(o: { totp?: boolean } = {}): Promise<Konto> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${konten.length}@example.test`,
      name: "Reauth",
      passwordHash: hash,
      ...(o.totp ? { totpSecret: seal(generateTotpSecret()), totpEnabledAt: new Date() } : {}),
    },
    select: { id: true },
  });
  konten.push(user.id);
  const sitzung = async () =>
    (
      await prisma.session.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
        select: { id: true },
      })
    ).id;
  return { id: user.id, sitzung: await sitzung(), zweite: await sitzung() };
}

function formular(felder: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

/** Ruft eine Aktion in einer Sitzung auf; eine Umleitung kommt als "umleitung" zurueck. */
async function als<T>(k: Konto, sitzung: string, fn: () => Promise<T>): Promise<T | "umleitung"> {
  mocks.person = { id: k.id, sessionId: sitzung };
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Umleitung) return "umleitung";
    throw e;
  }
}

const passwortAendern = (passwort: string) => () =>
  changePasswordAction(undefined, formular({ current: passwort, next: "Neues-Passwort-2" }));
const kontoLoeschen = (passwort: string) => () =>
  deleteAccountAction(undefined, formular({ password: passwort }));
const totpAus = (passwort: string) => () =>
  disableTotpAction(undefined, formular({ password: passwort }));
const neueCodes = (passwort: string) => () =>
  regenerateRecoveryCodesAction(undefined, formular({ password: passwort }));

function fehler(r: unknown): string | undefined {
  return r && typeof r === "object" && "error" in r ? String(r.error) : undefined;
}

async function audits(userId: string) {
  return prisma.auditLog.findMany({
    where: { action: "auth.reauth_failed", actorId: userId },
    orderBy: { createdAt: "asc" },
    select: { ip: true, metadata: true },
  });
}

async function widerrufen(sitzung: string): Promise<boolean> {
  const s = await prisma.session.findUnique({ where: { id: sitzung }, select: { revokedAt: true } });
  return s?.revokedAt != null;
}

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  hash = await bcrypt.hash(PASSWORT, 4);
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
});

beforeEach(() => {
  mocks.destroySession.mockClear();
});

afterAll(async () => {
  const sitzungen = await prisma.session.findMany({
    where: { userId: { in: konten } },
    select: { id: true },
  });
  const schluessel = [
    ...konten.map((id) => `dokunc:rl:reauth:${id}`),
    ...sitzungen.map((s) => `dokunc:rl:reauth-sitzung:${s.id}`),
  ];
  if (schluessel.length > 0) await redis.del(...schluessel);
  redis.disconnect();
  await prisma.auditLog.deleteMany({ where: { actorId: { in: konten } } });
  await prisma.user.deleteMany({ where: { id: { in: konten } } });
  vi.unstubAllEnvs();
});

describe("Passwortbestaetigung", () => {
  it("weist den 11. Versuch auch mit richtigem Passwort ab, auch aus einer anderen Sitzung", async () => {
    const k = await konto();
    // Zehn Fehlversuche aus der zweiten Sitzung: der zehnte beendet sie.
    for (let i = 0; i < 9; i++) {
      expect(fehler(await als(k, k.zweite, passwortAendern(FALSCH))), `Versuch ${i + 1}`).toBe(
        "Aktuelles Passwort ist falsch.",
      );
    }
    expect(fehler(await als(k, k.zweite, passwortAendern(FALSCH)))).toBe(REAUTH_SITZUNG_BEENDET);
    expect(await widerrufen(k.zweite)).toBe(true);
    expect(mocks.destroySession).toHaveBeenCalledTimes(1);

    // Der elfte kommt aus der ersten, gueltigen Sitzung, mit dem richtigen
    // Passwort: die Bremse gilt je Konto.
    expect(await widerrufen(k.sitzung)).toBe(false);
    expect(fehler(await als(k, k.sitzung, passwortAendern(PASSWORT)))).toBe(REAUTH_GEBREMST);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: k.id } });
    expect(await bcrypt.compare(PASSWORT, row.passwordHash)).toBe(true);

    const eintraege = await audits(k.id);
    expect(eintraege.map((e) => (e.metadata as { reason: string }).reason)).toEqual([
      ...Array(10).fill("bad_password"),
      "throttled",
    ]);
    expect(eintraege.every((e) => e.ip === "198.51.100.77")).toBe(true);
    expect(eintraege[9].metadata).toMatchObject({ operation: "password_change", sessionEnded: true });
    expect(eintraege[10].metadata).toMatchObject({ operation: "password_change", reason: "throttled" });
  });

  it("zaehlt alle vier Stellen in einem Zaehler je Konto", async () => {
    const k = await konto({ totp: true });
    for (let i = 0; i < 3; i++) {
      expect(fehler(await als(k, k.zweite, totpAus(FALSCH)))).toBe("Passwort ist falsch.");
    }
    for (let i = 0; i < 3; i++) {
      expect(fehler(await als(k, k.zweite, neueCodes(FALSCH)))).toBe("Passwort ist falsch.");
    }
    for (let i = 0; i < 3; i++) {
      expect(fehler(await als(k, k.zweite, kontoLoeschen(FALSCH)))).toBe("Passwort ist falsch.");
    }
    expect(fehler(await als(k, k.zweite, kontoLoeschen(FALSCH)))).toBe(REAUTH_SITZUNG_BEENDET);

    expect(fehler(await als(k, k.sitzung, passwortAendern(PASSWORT)))).toBe(REAUTH_GEBREMST);
    expect(fehler(await als(k, k.sitzung, kontoLoeschen(PASSWORT)))).toBe(REAUTH_GEBREMST);
    expect(fehler(await als(k, k.sitzung, totpAus(PASSWORT)))).toBe(REAUTH_GEBREMST);
    expect(await prisma.user.count({ where: { id: k.id } })).toBe(1);
    const operationen = (await audits(k.id)).map((e) => (e.metadata as { operation: string }).operation);
    expect(new Set(operationen)).toEqual(
      new Set(["totp_disable", "recovery_codes", "account_delete", "password_change"]),
    );
  });

  it("raeumt nach einem Erfolg beide Zaehler", async () => {
    const k = await konto({ totp: true });
    for (let runde = 0; runde < 2; runde++) {
      for (let i = 0; i < 9; i++) {
        expect(fehler(await als(k, k.sitzung, neueCodes(FALSCH)))).toBe("Passwort ist falsch.");
      }
      const ok = await als(k, k.sitzung, neueCodes(PASSWORT));
      expect(fehler(ok), `Runde ${runde + 1}`).toBeUndefined();
      expect(ok).toMatchObject({ recoveryCodes: expect.any(Array) });
    }
    expect(await widerrufen(k.sitzung)).toBe(false);
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("beendet die Sitzung nach 10 falschen Passwoertern, auch ueber das Fenster hinweg", async () => {
    const k = await konto();
    for (let i = 0; i < 6; i++) {
      expect(fehler(await als(k, k.sitzung, kontoLoeschen(FALSCH)))).toBe("Passwort ist falsch.");
    }
    // Zehn Minuten spaeter: das Fenster der Kontobremse ist abgelaufen.
    await redis.del(`dokunc:rl:reauth:${k.id}`);
    for (let i = 0; i < 3; i++) {
      expect(fehler(await als(k, k.sitzung, kontoLoeschen(FALSCH)))).toBe("Passwort ist falsch.");
    }
    expect(await widerrufen(k.sitzung)).toBe(false);
    expect(fehler(await als(k, k.sitzung, kontoLoeschen(FALSCH)))).toBe(REAUTH_SITZUNG_BEENDET);
    expect(await widerrufen(k.sitzung)).toBe(true);
    expect(mocks.destroySession).toHaveBeenCalledTimes(1);
    // Die naechste Anfrage dieser Sitzung fuehrt zur Anmeldung.
    expect(await als(k, k.sitzung, kontoLoeschen(PASSWORT))).toBe("umleitung");
    expect(await prisma.user.count({ where: { id: k.id } })).toBe(1);
    const letzter = (await audits(k.id)).at(-1);
    expect(letzter?.metadata).toMatchObject({
      operation: "account_delete",
      reason: "bad_password",
      sessionEnded: true,
    });
  });

  it("laesst ein anderes Konto unberuehrt", async () => {
    const a = await konto();
    const b = await konto();
    for (let i = 0; i < 10; i++) await als(a, a.zweite, passwortAendern(FALSCH));
    expect(fehler(await als(a, a.sitzung, passwortAendern(PASSWORT)))).toBe(REAUTH_GEBREMST);
    const ok = await als(b, b.sitzung, passwortAendern(PASSWORT));
    expect(ok).toEqual({ success: "Passwort geändert. Andere Sitzungen wurden beendet." });
  });

  it("zaehlt gleichzeitige Versuche vor dem Vergleich", async () => {
    const k = await konto();
    mocks.person = { id: k.id, sessionId: k.sitzung };
    // Gezaehlt wird vor bcrypt: von 15 gleichzeitigen Versuchen wird genau
    // zehnmal verglichen, nicht fuenfzehnmal.
    const vergleich = vi.spyOn(bcrypt, "compare");
    const ergebnisse = await Promise.all(
      Array.from({ length: 15 }, () => passwortAendern(FALSCH)()),
    );
    expect(vergleich).toHaveBeenCalledTimes(10);
    vergleich.mockRestore();
    const meldungen = ergebnisse.map(fehler);
    expect(meldungen.filter((m) => m === REAUTH_GEBREMST)).toHaveLength(5);
    expect(
      meldungen.filter((m) => m === "Aktuelles Passwort ist falsch." || m === REAUTH_SITZUNG_BEENDET),
    ).toHaveLength(10);
  });
});
