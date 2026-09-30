import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Das Cookie des zweiten Schritts hält fest, wie der erste lief. Ein
 * Cookie ohne diese Angabe (von vor dem Update) oder mit einem fremden
 * Wert gilt als Passwortweg: dort prüft der zweite Schritt die
 * SSO-Bindung erneut.
 */

const GEHEIMNIS = "pending-2fa-test-geheimnis-".padEnd(64, "x");
const kekse = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (kekse.has(name) ? { value: kekse.get(name) } : undefined),
    set: (name: string, wert: string) => void kekse.set(name, wert),
    delete: (name: string) => void kekse.delete(name),
  }),
}));
vi.mock("./secret", () => ({ getAppSecret: () => GEHEIMNIS }));

const { readPending2fa, startPending2fa } = await import("./pending-2fa");

async function altesCookie(nutzlast: Record<string, unknown>): Promise<void> {
  const token = await new SignJWT(nutzlast)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("konto-1")
    .setAudience("dokunc-2fa")
    .setIssuedAt()
    .setExpirationTime("300s")
    .sign(new TextEncoder().encode(GEHEIMNIS));
  kekse.set("dokunc_2fa", token);
}

beforeEach(() => kekse.clear());

describe("zweiter Schritt: Weg des ersten", () => {
  it("merkt sich sso und password", async () => {
    await startPending2fa("konto-1", "/spaces", "sso");
    expect(await readPending2fa()).toEqual({
      userId: "konto-1",
      next: "/spaces",
      via: "sso",
    });
    await startPending2fa("konto-1", "/spaces", "password");
    expect(await readPending2fa()).toMatchObject({ via: "password" });
  });

  it("ohne Angabe oder mit fremdem Wert: Passwortweg", async () => {
    await altesCookie({ next: "/spaces" });
    expect(await readPending2fa()).toEqual({
      userId: "konto-1",
      next: "/spaces",
      via: "password",
    });
    await altesCookie({ next: "/spaces", via: "SSO" });
    expect(await readPending2fa()).toMatchObject({ via: "password" });
  });
});
