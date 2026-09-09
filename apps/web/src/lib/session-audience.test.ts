import { describe, expect, it } from "vitest";
import { SignJWT, jwtVerify, errors } from "jose";

/**
 * Vier Token dieser App tragen dieselbe Signatur (HS256 mit
 * APP_SECRET): Sitzung, Collab-Ticket, Zwischenschritt der
 * Zwei-Faktor-Anmeldung und SSO-Fluss. Auseinandergehalten werden sie
 * allein über die Audience.
 *
 * Der Test prüft die Regel selbst und nicht die Anwendung: `session.ts`
 * hängt an `next/headers` und ist im Unit-Lauf nicht aufrufbar. Fällt
 * die Prüfung irgendwo weg, hilft dieser Test nicht — er hält fest,
 * warum sie da ist, und dass eine Audience genau das leistet.
 */
const SECRET = new TextEncoder().encode("test-secret-test-secret-test-1234");

const SESSION = "dokunc-session";
const OTHERS = ["dokunc-collab", "dokunc-2fa", "dokunc-oidc"];

function token(audience: string) {
  return new SignJWT({ tv: 0, sid: "s1" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("u1")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(SECRET);
}

describe("Audience trennt die Token dieser App", () => {
  it("nimmt das eigene Sitzungs-Token an", async () => {
    const { payload } = await jwtVerify(await token(SESSION), SECRET, {
      audience: SESSION,
    });
    expect(payload.sub).toBe("u1");
  });

  it("weist jedes andere Token ab, obwohl die Signatur stimmt", async () => {
    for (const other of OTHERS) {
      await expect(
        jwtVerify(await token(other), SECRET, { audience: SESSION }),
      ).rejects.toBeInstanceOf(errors.JWTClaimValidationFailed);
    }
  });

  it("weist ein Token ganz ohne Audience ab", async () => {
    const bare = await new SignJWT({ tv: 0, sid: "s1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setExpirationTime("5m")
      .sign(SECRET);
    await expect(
      jwtVerify(bare, SECRET, { audience: SESSION }),
    ).rejects.toBeInstanceOf(errors.JWTClaimValidationFailed);
  });
});
