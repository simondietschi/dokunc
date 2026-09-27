import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INVITE_LINK_MODE,
  inviteLinkMode,
  mayReceiveInviteLink,
  readInviteLinkMode,
} from "./invite-link";
import { log } from "./log";

const V = "INVITE_LINK_WITHOUT_MAIL";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readInviteLinkMode", () => {
  it("nimmt ohne Angabe still die Vorgabe admins", () => {
    const warn = vi.fn();
    expect(DEFAULT_INVITE_LINK_MODE).toBe("admins");
    expect(readInviteLinkMode({}, warn)).toBe("admins");
    expect(readInviteLinkMode({ [V]: "" }, warn)).toBe("admins");
    expect(readInviteLinkMode({ [V]: "  " }, warn)).toBe("admins");
    expect(warn).not.toHaveBeenCalled();
  });

  it("liest admins und managers getrimmt, gross/klein egal", () => {
    const warn = vi.fn();
    expect(readInviteLinkMode({ [V]: "managers" }, warn)).toBe("managers");
    expect(readInviteLinkMode({ [V]: " Managers " }, warn)).toBe("managers");
    expect(readInviteLinkMode({ [V]: "admins" }, warn)).toBe("admins");
    expect(readInviteLinkMode({ [V]: "ADMINS" }, warn)).toBe("admins");
    expect(warn).not.toHaveBeenCalled();
  });

  it("nimmt bei anderen Werten die Vorgabe und warnt", () => {
    for (const wert of ["alle", "true"]) {
      const warn = vi.fn();
      expect(readInviteLinkMode({ [V]: wert }, warn)).toBe("admins");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { variable: V, wert },
        "Ungueltiger Wert, Vorgabe gilt",
      );
    }
  });

  it("kuerzt einen langen Wert in der Warnung auf 40 Zeichen", () => {
    const warn = vi.fn();
    const lang = "x".repeat(60);
    expect(readInviteLinkMode({ [V]: lang }, warn)).toBe("admins");
    expect(warn.mock.calls[0][0]).toEqual({ variable: V, wert: "x".repeat(40) });
  });
});

describe("inviteLinkMode", () => {
  it("liest process.env bei jedem Aufruf und warnt nur einmal je Prozess", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    vi.stubEnv(V, "managers");
    expect(inviteLinkMode()).toBe("managers");
    vi.stubEnv(V, "alle");
    expect(inviteLinkMode()).toBe("admins");
    expect(inviteLinkMode()).toBe("admins");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { variable: V, wert: "alle" },
      "Ungueltiger Wert, Vorgabe gilt",
    );
  });
});

describe("mayReceiveInviteLink", () => {
  it("gibt den Link nach Vorgabe nur Admin-Personen der Instanz", () => {
    expect(mayReceiveInviteLink({ isAdmin: false }, "admins")).toBe(false);
    expect(mayReceiveInviteLink({ isAdmin: true }, "admins")).toBe(true);
  });

  it("gibt ihn mit managers allen, die den Space verwalten", () => {
    expect(mayReceiveInviteLink({ isAdmin: false }, "managers")).toBe(true);
    expect(mayReceiveInviteLink({ isAdmin: true }, "managers")).toBe(true);
  });
});
