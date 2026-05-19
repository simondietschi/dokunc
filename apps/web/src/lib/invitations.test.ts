import { describe, it, expect } from "vitest";
import {
  generateInviteToken,
  hashToken,
  verifyToken,
  safeEqualHex,
  isInvitableRole,
  normalizeEmail,
  inviteExpiry,
  INVITE_TTL_MS,
} from "./invitations";

describe("invitation tokens", () => {
  it("erzeugt ein Token plus passenden Hash, Token nicht im Klartext gespeichert", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toHaveLength(43); // 32 bytes base64url
    expect(tokenHash).toHaveLength(64); // sha256 hex
    expect(tokenHash).not.toContain(token);
    expect(hashToken(token)).toBe(tokenHash);
  });

  it("Tokens sind eindeutig", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("verifyToken akzeptiert nur das korrekte Token", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(verifyToken(token, tokenHash)).toBe(true);
    expect(verifyToken("falsch", tokenHash)).toBe(false);
    expect(verifyToken("", tokenHash)).toBe(false);
    expect(verifyToken(token, "")).toBe(false);
  });

  it("safeEqualHex vergleicht gültige Hex-Hashes konstantzeit", () => {
    const h = hashToken("x");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashToken("y"))).toBe(false);
    expect(safeEqualHex("abcd", "abcdef")).toBe(false); // Längen-Mismatch
  });

  it("Ablaufzeit liegt TTL in der Zukunft", () => {
    const now = 1_000_000;
    expect(inviteExpiry(now).getTime()).toBe(now + INVITE_TTL_MS);
  });
});

describe("role + email helpers", () => {
  it("isInvitableRole verbietet OWNER und Unsinn", () => {
    expect(isInvitableRole("ADMIN")).toBe(true);
    expect(isInvitableRole("MEMBER")).toBe(true);
    expect(isInvitableRole("VIEWER")).toBe(true);
    expect(isInvitableRole("OWNER")).toBe(false);
    expect(isInvitableRole("root")).toBe(false);
    expect(isInvitableRole(undefined)).toBe(false);
  });

  it("normalizeEmail trimmt und kleinschreibt", () => {
    expect(normalizeEmail("  Alex@Team.DE ")).toBe("alex@team.de");
  });
});
