import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_DOC_MB,
  WS_DEFAULT_MAX_PAYLOAD,
  docSizeLevel,
  readDocSizeLimits,
} from "@dokunc/editor";

const MiB = 1024 * 1024;

function lies(env: Record<string, string | undefined>) {
  const warn = vi.fn();
  return { limits: readDocSizeLimits(env, warn), warn };
}

describe("readDocSizeLimits()", () => {
  it("ohne Angaben: 16 MiB Dokument, Warnung ab 8 MiB, Nachricht 17 MiB", () => {
    const { limits, warn } = lies({});
    expect(DEFAULT_MAX_DOC_MB).toBe(16);
    expect(limits).toEqual({
      maxDocBytes: 16 * MiB,
      warnDocBytes: 8 * MiB,
      maxMessageBytes: 17 * MiB,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("leere Werte gelten als nicht gesetzt", () => {
    const { limits, warn } = lies({
      COLLAB_MAX_DOC_MB: "",
      COLLAB_MAX_MESSAGE_MB: "  ",
    });
    expect(limits.maxMessageBytes).toBe(17 * MiB);
    expect(warn).not.toHaveBeenCalled();
  });

  it("die Nachrichtengrenze folgt der Dokumentgrenze plus 1 MiB", () => {
    const { limits, warn } = lies({ COLLAB_MAX_DOC_MB: "4" });
    expect(limits).toEqual({
      maxDocBytes: 4 * MiB,
      warnDocBytes: 2 * MiB,
      maxMessageBytes: 5 * MiB,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("ohne Dokumentgrenze bleibt die Vorgabe von ws (100 MiB)", () => {
    const { limits, warn } = lies({ COLLAB_MAX_DOC_MB: "0" });
    expect(limits).toEqual({
      maxDocBytes: 0,
      warnDocBytes: 0,
      maxMessageBytes: WS_DEFAULT_MAX_PAYLOAD,
    });
    expect(WS_DEFAULT_MAX_PAYLOAD).toBe(100 * MiB);
    expect(warn).not.toHaveBeenCalled();
  });

  it("eine Nachrichtengrenze unter Dokument plus 1 gilt, mit genau einer Warnung", () => {
    const { limits, warn } = lies({ COLLAB_MAX_MESSAGE_MB: "2" });
    expect(limits.maxMessageBytes).toBe(2 * MiB);
    expect(limits.maxDocBytes).toBe(16 * MiB);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({
      variable: "COLLAB_MAX_MESSAGE_MB",
      wert: "2",
    });
  });

  it("Nachrichtengrenze genau Dokument plus 1: keine Warnung", () => {
    const { limits, warn } = lies({
      COLLAB_MAX_DOC_MB: "4",
      COLLAB_MAX_MESSAGE_MB: "5",
    });
    expect(limits.maxMessageBytes).toBe(5 * MiB);
    expect(warn).not.toHaveBeenCalled();
  });

  it("COLLAB_MAX_MESSAGE_MB=0 heisst keine Grenze, ohne Warnung", () => {
    const { limits, warn } = lies({ COLLAB_MAX_MESSAGE_MB: "0" });
    expect(limits.maxMessageBytes).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["-1", "1.5", "zehn", "1e3"])(
    "Unsinn %j: Vorgabe mit Warnung, fuer beide Variablen",
    (roh) => {
      const doc = lies({ COLLAB_MAX_DOC_MB: roh });
      expect(doc.limits.maxDocBytes).toBe(16 * MiB);
      expect(doc.limits.maxMessageBytes).toBe(17 * MiB);
      expect(doc.warn).toHaveBeenCalledTimes(1);
      expect(doc.warn.mock.calls[0]).toEqual([
        { variable: "COLLAB_MAX_DOC_MB", wert: roh },
        "Ungueltige Groessengrenze, Vorgabe gilt",
      ]);

      const msg = lies({ COLLAB_MAX_MESSAGE_MB: roh });
      expect(msg.limits.maxMessageBytes).toBe(17 * MiB);
      expect(msg.warn).toHaveBeenCalledTimes(1);
      expect(msg.warn.mock.calls[0]).toEqual([
        { variable: "COLLAB_MAX_MESSAGE_MB", wert: roh },
        "Ungueltige Groessengrenze, Vorgabe gilt",
      ]);
    },
  );
});

describe("docSizeLevel()", () => {
  const limits = readDocSizeLimits({ COLLAB_MAX_DOC_MB: "2" }, () => undefined);

  it("ok unter der Warnschwelle, warn ab ihr bis einschliesslich der Grenze", () => {
    expect(docSizeLevel(limits.warnDocBytes - 1, limits)).toBe("ok");
    expect(docSizeLevel(limits.warnDocBytes, limits)).toBe("warn");
    expect(docSizeLevel(limits.maxDocBytes, limits)).toBe("warn");
  });

  it("frozen erst echt ueber der Grenze", () => {
    expect(docSizeLevel(limits.maxDocBytes + 1, limits)).toBe("frozen");
  });

  it("ohne Dokumentgrenze immer ok", () => {
    const aus = readDocSizeLimits({ COLLAB_MAX_DOC_MB: "0" }, () => undefined);
    for (const bytes of [0, 1, 1024 * MiB]) {
      expect(docSizeLevel(bytes, aus)).toBe("ok");
    }
  });
});
