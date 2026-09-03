import { describe, it, expect } from "vitest";
import {
  planDispatch,
  INSTANT_BATCH_WINDOW_MS,
  type DispatchCandidate,
  type EmailMode,
} from "@dokunc/mail";

const NOW = new Date("2026-09-03T10:00:00Z");

function candidate(
  overrides: Partial<DispatchCandidate> & {
    id: string;
    mode?: EmailMode;
    ageMs?: number;
    isActive?: boolean;
  },
): DispatchCandidate {
  const { mode = "INSTANT", ageMs = 60_000, isActive = true, ...rest } =
    overrides;
  return {
    id: rest.id,
    userId: rest.userId ?? "u1",
    createdAt: rest.createdAt ?? new Date(NOW.getTime() - ageMs),
    readAt: rest.readAt ?? null,
    user: rest.user ?? {
      email: `${rest.userId ?? "u1"}@example.com`,
      name: "Alex",
      isActive,
      emailNotifications: mode,
    },
    item: rest.item ?? {
      type: "MENTION",
      actorName: "Kim",
      pageTitle: "Seite",
      url: "http://localhost:3000/p/x",
    },
  };
}

describe("planDispatch()", () => {
  it("leer -> leer", () => {
    expect(planDispatch([], NOW, { digest: false })).toEqual({
      send: [],
      markOnly: [],
    });
  });

  it("OFF, inaktiv oder gelesen -> nur markieren, keine Mail", () => {
    const plan = planDispatch(
      [
        candidate({ id: "off", mode: "OFF" }),
        candidate({ id: "inactive", isActive: false }),
        candidate({ id: "read", readAt: NOW }),
        candidate({ id: "daily-read", mode: "DAILY", readAt: NOW }),
      ],
      NOW,
      { digest: true },
    );
    expect(plan.send).toEqual([]);
    expect(plan.markOnly.sort()).toEqual(
      ["daily-read", "inactive", "off", "read"].sort(),
    );
  });

  it("INSTANT: nur Eintraege ausserhalb des Sammelfensters", () => {
    const plan = planDispatch(
      [
        candidate({ id: "old", ageMs: INSTANT_BATCH_WINDOW_MS + 1 }),
        candidate({ id: "fresh", ageMs: 5_000 }),
      ],
      NOW,
      { digest: false },
    );
    expect(plan.send).toHaveLength(1);
    expect(plan.send[0].notificationIds).toEqual(["old"]);
    expect(plan.send[0].mode).toBe("INSTANT");
    // "fresh" bleibt offen: weder gesendet noch markiert.
    expect(plan.markOnly).toEqual([]);
  });

  it("INSTANT: pro Nutzer gruppiert, aelteste zuerst", () => {
    const plan = planDispatch(
      [
        candidate({ id: "b", userId: "u1", ageMs: 30_000 }),
        candidate({ id: "a", userId: "u1", ageMs: 90_000 }),
        candidate({ id: "c", userId: "u2", ageMs: 40_000 }),
      ],
      NOW,
      { digest: false },
    );
    expect(plan.send).toHaveLength(2);
    const u1 = plan.send.find((b) => b.userId === "u1")!;
    expect(u1.notificationIds).toEqual(["a", "b"]);
    expect(u1.items).toHaveLength(2);
    expect(u1.email).toBe("u1@example.com");
    const u2 = plan.send.find((b) => b.userId === "u2")!;
    expect(u2.notificationIds).toEqual(["c"]);
  });

  it("DAILY: wartet auf den Digest-Lauf", () => {
    const items = [
      candidate({ id: "d1", mode: "DAILY", ageMs: 3_600_000 }),
      candidate({ id: "d2", mode: "DAILY", ageMs: 1_000 }),
    ];
    const regular = planDispatch(items, NOW, { digest: false });
    expect(regular.send).toEqual([]);
    expect(regular.markOnly).toEqual([]);

    const digest = planDispatch(items, NOW, { digest: true });
    expect(digest.send).toHaveLength(1);
    expect(digest.send[0].mode).toBe("DAILY");
    // Im Digest zaehlt das Sammelfenster nicht: auch frische Eintraege.
    expect(digest.send[0].notificationIds).toEqual(["d1", "d2"]);
  });

  it("INSTANT-Eintraege werden auch im Digest-Lauf sofort versendet", () => {
    const plan = planDispatch(
      [
        candidate({ id: "i", mode: "INSTANT", userId: "u1" }),
        candidate({ id: "d", mode: "DAILY", userId: "u2" }),
      ],
      NOW,
      { digest: true },
    );
    expect(plan.send.map((b) => b.mode).sort()).toEqual(["DAILY", "INSTANT"]);
  });

  it("Sammelfenster ist konfigurierbar", () => {
    const plan = planDispatch(
      [candidate({ id: "x", ageMs: 2_000 })],
      NOW,
      { digest: false, batchWindowMs: 1_000 },
    );
    expect(plan.send[0]?.notificationIds).toEqual(["x"]);
  });
});
