import { describe, expect, it, vi } from "vitest";
import {
  DAY_MS,
  DEFAULT_RETENTION,
  MAX_RETENTION_DAYS,
  readRetentionConfig,
  retentionActive,
  retentionCutoff,
  retentionNotes,
  type RetentionConfig,
} from "./retention-config";

const VARIABLEN = [
  "SESSION_RETENTION_DAYS",
  "TOKEN_RETENTION_DAYS",
  "NOTIFICATION_RETENTION_DAYS",
  "AUDIT_RETENTION_DAYS",
  "TRASH_RETENTION_DAYS",
] as const;

const FELD: Record<(typeof VARIABLEN)[number], keyof RetentionConfig> = {
  SESSION_RETENTION_DAYS: "sessionDays",
  TOKEN_RETENTION_DAYS: "tokenDays",
  NOTIFICATION_RETENTION_DAYS: "notificationDays",
  AUDIT_RETENTION_DAYS: "auditDays",
  TRASH_RETENTION_DAYS: "trashDays",
};

describe("readRetentionConfig", () => {
  it("nimmt ohne Angabe still die Vorgaben", () => {
    const warn = vi.fn();
    expect(readRetentionConfig({}, warn)).toEqual(DEFAULT_RETENTION);
    const leer = Object.fromEntries(
      [...VARIABLEN, "VERSION_RETENTION"].map((v) => [v, "  "]),
    );
    expect(readRetentionConfig(leer, warn)).toEqual(DEFAULT_RETENTION);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(VARIABLEN)("liest %s als ganze Zahl, 0 heisst unbegrenzt", (variable) => {
    const warn = vi.fn();
    expect(readRetentionConfig({ [variable]: "0" }, warn)[FELD[variable]]).toBe(0);
    expect(readRetentionConfig({ [variable]: " 45 " }, warn)[FELD[variable]]).toBe(45);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["-1", "1.5", "1e3", "abc", "30d"])(
    "nimmt bei %j die Vorgabe und warnt mit dem Namen der Variable",
    (wert) => {
      for (const variable of VARIABLEN) {
        const warn = vi.fn();
        const c = readRetentionConfig({ [variable]: wert }, warn);
        expect(c[FELD[variable]]).toBe(DEFAULT_RETENTION[FELD[variable]]);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ variable, wert }),
          expect.stringContaining("Vorgabe"),
        );
      }
    },
  );

  it("kappt zu grosse Werte mit Warnung", () => {
    const warn = vi.fn();
    const c = readRetentionConfig({ AUDIT_RETENTION_DAYS: "99999999" }, warn);
    expect(c.auditDays).toBe(MAX_RETENTION_DAYS);
    expect(warn).toHaveBeenCalledWith(
      { variable: "AUDIT_RETENTION_DAYS", wert: "99999999", gilt: 36_500 },
      expect.stringContaining("gekappt"),
    );
  });

  it("liest VERSION_RETENTION als standard oder off", () => {
    const warn = vi.fn();
    expect(readRetentionConfig({ VERSION_RETENTION: "off" }, warn).versions).toBe(false);
    expect(readRetentionConfig({ VERSION_RETENTION: " OFF " }, warn).versions).toBe(false);
    expect(readRetentionConfig({ VERSION_RETENTION: "standard" }, warn).versions).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(readRetentionConfig({ VERSION_RETENTION: "aus" }, warn).versions).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ variable: "VERSION_RETENTION", wert: "aus" }),
      expect.stringContaining("Vorgabe"),
    );
  });
});

const ALLES_AUS: RetentionConfig = {
  sessionDays: 0,
  tokenDays: 0,
  notificationDays: 0,
  auditDays: 0,
  trashDays: 0,
  versions: false,
};

describe("retentionActive", () => {
  it("ist aus, wenn alle Fristen 0 und das Ausduennen aus ist", () => {
    expect(retentionActive(ALLES_AUS)).toBe(false);
    for (const feld of Object.values(FELD)) {
      expect(retentionActive({ ...ALLES_AUS, [feld]: 1 })).toBe(true);
    }
    expect(retentionActive({ ...ALLES_AUS, versions: true })).toBe(true);
  });
});

describe("retentionCutoff", () => {
  it("rechnet ganze Tage zurueck", () => {
    const now = new Date("2001-03-01T12:00:00Z");
    expect(retentionCutoff(now, 30).getTime()).toBe(now.getTime() - 30 * DAY_MS);
  });
});

describe("retentionNotes", () => {
  it("nennt das Ausduennen nur, wenn es laeuft", () => {
    expect(retentionNotes(DEFAULT_RETENTION).verlauf).toContain(
      "aus den letzten 24 Stunden bleibt jede",
    );
    expect(retentionNotes({ ...DEFAULT_RETENTION, versions: false }).verlauf).toBeNull();
  });

  it("nennt die Frist des Papierkorbs, in der Einzahl bei 1", () => {
    expect(retentionNotes(DEFAULT_RETENTION).papierkorb).toBeNull();
    expect(retentionNotes({ ...DEFAULT_RETENTION, trashDays: 30 }).papierkorb).toBe(
      "Seiten im Papierkorb werden 30 Tage nach dem Löschen endgültig entfernt.",
    );
    expect(retentionNotes({ ...DEFAULT_RETENTION, trashDays: 1 }).papierkorb).toContain(
      "1 Tag nach dem Löschen",
    );
  });

  it("beschreibt das Audit-Log mit und ohne Frist, ohne 'nie geändert'", () => {
    const mit = retentionNotes(DEFAULT_RETENTION).audit;
    expect(mit).toContain("nach 365 Tagen werden sie gelöscht");
    expect(retentionNotes({ ...DEFAULT_RETENTION, auditDays: 1 }).audit).toContain(
      "nach 1 Tag werden",
    );
    const ohne = retentionNotes({ ...DEFAULT_RETENTION, auditDays: 0 }).audit;
    expect(ohne).not.toContain("werden sie gelöscht");
    expect(ohne).toContain("bei gelöschten Spaces entfällt der Bezug zum Space");
    for (const text of [mit, ohne]) expect(text).not.toContain("nie geändert");
  });
});
