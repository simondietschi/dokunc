import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@dokunc/db";
import {
  changeMemberRole,
  removeSpaceMember,
  type MemberChange,
  type MemberScope,
} from "@/lib/member-changes";

/**
 * Der letzte Eigentuemer bleibt — auch wenn zwei gleichzeitig handeln.
 *
 * Zwei Eigentuemer, die einander im selben Moment herabstufen oder
 * entfernen, zaehlten vorher beide zwei Owner, beide schrieben, und der
 * Space stand ohne Eigentuemer da. Die Regel selbst (lib/role-policy)
 * war dabei nie falsch; falsch war, dass Zaehlen und Schreiben getrennt
 * liefen. Das laesst sich nur gegen eine echte Datenbank zeigen.
 */

const TAG = `owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Mehrere Runden: ein einzelner Lauf kann zufaellig nacheinander landen. */
const RUNDEN = 6;

let spaceId: string;
let alice: { id: string };
let bob: { id: string };
let asAlice: MemberScope;
let asBob: MemberScope;

beforeAll(async () => {
  [alice, bob] = await Promise.all(
    ["alice", "bob"].map((n) =>
      prisma.user.create({
        data: { email: `${TAG}-${n}@example.test`, name: n, passwordHash: "x" },
        select: { id: true },
      }),
    ),
  );
  const space = await prisma.space.create({
    data: { name: TAG, slug: TAG },
    select: { id: true },
  });
  spaceId = space.id;
  asAlice = { spaceId, actorId: alice.id, actorRole: "OWNER" };
  asBob = { spaceId, actorId: bob.id, actorRole: "OWNER" };
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({
    where: { id: { in: [alice.id, bob.id] } },
  });
});

/** Ausgangslage jeder Runde: genau zwei aktive Eigentuemer. */
async function zweiEigentuemer() {
  await prisma.spaceMember.deleteMany({ where: { spaceId } });
  const a = await prisma.spaceMember.create({
    data: { spaceId, userId: alice.id, role: "OWNER" },
    select: { id: true },
  });
  const b = await prisma.spaceMember.create({
    data: { spaceId, userId: bob.id, role: "OWNER" },
    select: { id: true },
  });
  return { aliceMember: a.id, bobMember: b.id };
}

function aktiveEigentuemer() {
  return prisma.spaceMember.count({
    where: { spaceId, role: "OWNER", user: { isActive: true } },
  });
}

/** Genau einer setzt sich durch; der andere erfaehrt es, statt zu schreiben. */
function erwarteEinenGewinner(results: MemberChange[]) {
  const statuses = results.map((r) => r.status).sort();
  expect(statuses.filter((s) => s === "erledigt")).toHaveLength(1);
  const verlierer = statuses.find((s) => s !== "erledigt");
  expect(["abgelehnt", "gleichzeitig"]).toContain(verlierer);
}

describe("einzeln", () => {
  it("stuft einen von zwei Eigentuemern herab", async () => {
    const { bobMember } = await zweiEigentuemer();
    const r = await changeMemberRole(asAlice, bobMember, "ADMIN");
    expect(r.status).toBe("erledigt");
    if (r.status === "erledigt") expect(r.member.role).toBe("OWNER");
    expect(await aktiveEigentuemer()).toBe(1);
  });

  it("stuft den letzten Eigentuemer nicht herab", async () => {
    const { aliceMember, bobMember } = await zweiEigentuemer();
    await changeMemberRole(asAlice, bobMember, "ADMIN");
    // Bob ist jetzt ADMIN, handelt aber mit der Rolle aus seiner Anfrage.
    const r = await changeMemberRole(asBob, aliceMember, "ADMIN");
    expect(r.status).toBe("abgelehnt");
    expect(await aktiveEigentuemer()).toBe(1);
  });

  it("entfernt den letzten Eigentuemer nicht", async () => {
    const { aliceMember, bobMember } = await zweiEigentuemer();
    expect((await removeSpaceMember(asAlice, bobMember)).status).toBe(
      "erledigt",
    );
    expect((await removeSpaceMember(asBob, aliceMember)).status).toBe(
      "abgelehnt",
    );
    expect(await aktiveEigentuemer()).toBe(1);
  });

  it("meldet eine unveraenderte Rolle und ein fremdes Mitglied", async () => {
    const { bobMember } = await zweiEigentuemer();
    expect((await changeMemberRole(asAlice, bobMember, "OWNER")).status).toBe(
      "unveraendert",
    );
    expect((await changeMemberRole(asAlice, "gibt-es-nicht", "ADMIN")).status)
      .toBe("fehlt");
    expect((await removeSpaceMember(asAlice, "gibt-es-nicht")).status).toBe(
      "fehlt",
    );
  });
});

describe("gleichzeitig", () => {
  it("zwei Eigentuemer stufen einander herab: einer bleibt", async () => {
    for (let i = 0; i < RUNDEN; i++) {
      const { aliceMember, bobMember } = await zweiEigentuemer();
      const results = await Promise.all([
        changeMemberRole(asAlice, bobMember, "ADMIN"),
        changeMemberRole(asBob, aliceMember, "ADMIN"),
      ]);
      expect(await aktiveEigentuemer()).toBe(1);
      erwarteEinenGewinner(results);
    }
  });

  it("zwei Eigentuemer entfernen einander: einer bleibt", async () => {
    for (let i = 0; i < RUNDEN; i++) {
      const { aliceMember, bobMember } = await zweiEigentuemer();
      const results = await Promise.all([
        removeSpaceMember(asAlice, bobMember),
        removeSpaceMember(asBob, aliceMember),
      ]);
      expect(await aktiveEigentuemer()).toBe(1);
      erwarteEinenGewinner(results);
    }
  });

  it("Herabstufen und Entfernen ueber Kreuz: einer bleibt", async () => {
    for (let i = 0; i < RUNDEN; i++) {
      const { aliceMember, bobMember } = await zweiEigentuemer();
      const results = await Promise.all([
        changeMemberRole(asAlice, bobMember, "VIEWER"),
        removeSpaceMember(asBob, aliceMember),
      ]);
      expect(await aktiveEigentuemer()).toBe(1);
      erwarteEinenGewinner(results);
    }
  });
});
