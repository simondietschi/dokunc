import { describe, expect, it } from "vitest";
import { decodeJwt, jwtVerify } from "jose";
import { COLLAB_AUDIENCE } from "@dokunc/editor";
import { COLLAB_TICKET_TTL_SEC, issueCollabTicket } from "./collab-ticket";
import { getAppSecret } from "./secret";

const OPTS = {
  userId: "u1",
  tokenVersion: 3,
  sessionId: "s1",
  pageId: "p1",
};

describe("issueCollabTicket", () => {
  it("stellt ein Ticket fuer genau diese Person, Sitzung und Seite aus", async () => {
    const ticket = await issueCollabTicket(OPTS);
    const { payload } = await jwtVerify(
      ticket,
      new TextEncoder().encode(getAppSecret()),
      { audience: COLLAB_AUDIENCE },
    );
    expect(payload).toMatchObject({ sub: "u1", tv: 3, sid: "s1", pid: "p1" });
    expect(payload.exp! - payload.iat!).toBe(COLLAB_TICKET_TTL_SEC);
  });

  // Der Collab-Server loest das Ticket ueber die jti genau einmal ein
  // und weist Tickets ohne jti ab. Zwei Tickets duerfen sich also nie
  // eine jti teilen, sonst verbraucht das erste das zweite.
  it("gibt jedem Ticket eine eigene jti", async () => {
    const a = decodeJwt(await issueCollabTicket(OPTS));
    const b = decodeJwt(await issueCollabTicket(OPTS));
    expect(typeof a.jti).toBe("string");
    expect(a.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.jti).not.toBe(a.jti);
  });

  // Der Collab-Server vergleicht ep mit der aktuellen Restore-Epoche.
  // Ohne Angabe traegt das Ticket null (nie zurueckgespielt), nicht
  // "kein Claim": sonst fiele ein fehlender Claim nicht auf.
  it("traegt die Restore-Epoche als ep, null ohne Angabe", async () => {
    const ohne = decodeJwt(await issueCollabTicket(OPTS));
    expect(ohne).toHaveProperty("ep", null);
    const E = "0123456789abcdef0123456789abcdef";
    const mit = decodeJwt(await issueCollabTicket({ ...OPTS, restoreEpoch: E }));
    expect(mit.ep).toBe(E);
  });
});
