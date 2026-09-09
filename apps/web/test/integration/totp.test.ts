import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";
import {
  claimTotpStep,
  consumeRecoveryCode,
  issueRecoveryCodes,
} from "@/lib/totp-store";

/**
 * Die beiden Zusagen des zweiten Faktors, die nicht im Code stehen,
 * sondern in Abfragebedingungen: ein Zeitschritt gilt einmal, ein
 * Wiederherstellungscode gilt einmal. Beides gegen eine echte Datenbank
 * — ein Mock würde genau die Bedingung nachbauen, die zu prüfen ist.
 */

const TAG = `totp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let userId: string;
let otherId: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.user.create({
      data: {
        email: `${TAG}-a@example.test`,
        name: "TOTP A",
        passwordHash: "x",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: `${TAG}-b@example.test`,
        name: "TOTP B",
        passwordHash: "x",
      },
      select: { id: true },
    }),
  ]);
  userId = a.id;
  otherId = b.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
});

describe("Zeitschritt", () => {
  it("nimmt denselben Schritt kein zweites Mal", async () => {
    const step = 60_000_000;
    expect(await claimTotpStep(userId, step)).toBe(true);
    expect(await claimTotpStep(userId, step)).toBe(false);
    // Auch ein älterer Schritt ist verbraucht: sonst liesse sich der
    // Vorgänger-Code aus demselben Fenster nachreichen.
    expect(await claimTotpStep(userId, step - 1)).toBe(false);
    expect(await claimTotpStep(userId, step + 1)).toBe(true);
  });

  it("gewinnt bei gleichzeitigen Versuchen genau einmal", async () => {
    const step = 70_000_000;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimTotpStep(userId, step)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("betrifft nur das eigene Konto", async () => {
    const step = 80_000_000;
    expect(await claimTotpStep(userId, step)).toBe(true);
    expect(await claimTotpStep(otherId, step)).toBe(true);
  });
});

describe("Wiederherstellungscodes", () => {
  it("legt nur Hashes ab", async () => {
    const codes = await issueRecoveryCodes(userId, 4);
    expect(codes).toHaveLength(4);
    const rows = await prisma.totpRecoveryCode.findMany({
      where: { userId },
      select: { codeHash: true, usedAt: true },
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.usedAt === null)).toBe(true);
    for (const code of codes) {
      expect(rows.some((r) => r.codeHash === code)).toBe(false);
      expect(rows.some((r) => r.codeHash.length === 64)).toBe(true);
    }
  });

  it("löst jeden Code genau einmal ein", async () => {
    const codes = await issueRecoveryCodes(userId, 3);
    expect(await consumeRecoveryCode(userId, codes[0])).toBe(true);
    expect(await consumeRecoveryCode(userId, codes[0])).toBe(false);
    // Die übrigen Codes bleiben gültig.
    expect(await consumeRecoveryCode(userId, codes[1])).toBe(true);
  });

  it("verzeiht Gross- und Trennzeichen beim Abtippen", async () => {
    const codes = await issueRecoveryCodes(userId, 2);
    const typed = codes[0].toUpperCase().replace("-", " ");
    expect(await consumeRecoveryCode(userId, typed)).toBe(true);
  });

  it("nimmt keinen fremden Code an", async () => {
    const [mine] = await issueRecoveryCodes(userId, 2);
    await issueRecoveryCodes(otherId, 2);
    expect(await consumeRecoveryCode(otherId, mine)).toBe(false);
    expect(await consumeRecoveryCode(userId, mine)).toBe(true);
  });

  it("gibt bei gleichzeitigem Einlösen nur einmal grünes Licht", async () => {
    const [code] = await issueRecoveryCodes(userId, 2);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeRecoveryCode(userId, code)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("wirft die alten Codes weg, wenn neue entstehen", async () => {
    const first = await issueRecoveryCodes(userId, 3);
    const second = await issueRecoveryCodes(userId, 3);
    expect(await consumeRecoveryCode(userId, first[0])).toBe(false);
    expect(await consumeRecoveryCode(userId, second[0])).toBe(true);
    expect(
      await prisma.totpRecoveryCode.count({ where: { userId } }),
    ).toBe(3);
  });
});
