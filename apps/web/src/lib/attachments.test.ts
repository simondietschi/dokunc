import { describe, it, expect, vi } from "vitest";
import {
  resolveFileAccess,
  likeEscape,
  contentDisposition,
  fileResponseHeaders,
  type AttachmentInfo,
  type FileAccessDeps,
} from "./attachments";

const record: AttachmentInfo = {
  id: "att1",
  spaceId: "space-a",
  pageId: "page-1",
  storedName: "abc.pdf",
  name: "Bericht.pdf",
  mimeType: "application/pdf",
  size: 1234,
};

function deps(over: Partial<FileAccessDeps> = {}): FileAccessDeps {
  return {
    findAttachment: vi.fn(async () => null),
    isMember: vi.fn(async () => false),
    findLegacyPage: vi.fn(async () => null),
    fileSize: vi.fn(async () => null),
    createAttachment: vi.fn(async (data) => ({ id: "neu", ...data })),
    ...over,
  };
}

describe("resolveFileAccess()", () => {
  it("liefert den Datensatz fuer Mitglieder des Space", async () => {
    const d = deps({
      findAttachment: vi.fn(async () => record),
      isMember: vi.fn(async (_u, s) => s === "space-a"),
    });
    expect(await resolveFileAccess("abc.pdf", "u1", d)).toEqual(record);
    expect(d.findLegacyPage).not.toHaveBeenCalled();
  });

  it("verweigert Nicht-Mitgliedern (kein Fallback auf Altbestand)", async () => {
    const d = deps({ findAttachment: vi.fn(async () => record) });
    expect(await resolveFileAccess("abc.pdf", "u1", d)).toBeNull();
    expect(d.findLegacyPage).not.toHaveBeenCalled();
    expect(d.createAttachment).not.toHaveBeenCalled();
  });

  it("traegt den Altbestand nach, wenn die Seite zugaenglich ist", async () => {
    const d = deps({
      findLegacyPage: vi.fn(async () => ({ id: "p9", spaceId: "space-b" })),
      isMember: vi.fn(async (_u, s) => s === "space-b"),
      fileSize: vi.fn(async () => 777),
    });
    const res = await resolveFileAccess("alt.png", "u1", d);
    expect(res).toMatchObject({
      spaceId: "space-b",
      pageId: "p9",
      storedName: "alt.png",
      name: "alt.png",
      mimeType: "image/png",
      size: 777,
    });
    expect(d.createAttachment).toHaveBeenCalledTimes(1);
  });

  it("Altbestand: ohne Mitgliedschaft kein Datensatz und kein Zugriff", async () => {
    const d = deps({
      findLegacyPage: vi.fn(async () => ({ id: "p9", spaceId: "space-b" })),
      fileSize: vi.fn(async () => 777),
    });
    expect(await resolveFileAccess("alt.png", "u1", d)).toBeNull();
    expect(d.createAttachment).not.toHaveBeenCalled();
  });

  it("Altbestand: fehlende Datei auf der Platte -> null", async () => {
    const d = deps({
      findLegacyPage: vi.fn(async () => ({ id: "p9", spaceId: "space-b" })),
      isMember: vi.fn(async () => true),
      fileSize: vi.fn(async () => null),
    });
    expect(await resolveFileAccess("weg.png", "u1", d)).toBeNull();
    expect(d.createAttachment).not.toHaveBeenCalled();
  });

  it("ohne Datensatz und ohne referenzierende Seite -> null", async () => {
    const d = deps();
    expect(await resolveFileAccess("fremd.bin", "u1", d)).toBeNull();
  });

  it("Unique-Konflikt beim Nachtragen: vorhandenen Datensatz verwenden", async () => {
    const find = vi
      .fn<FileAccessDeps["findAttachment"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...record, storedName: "alt.png" });
    const d = deps({
      findAttachment: find,
      findLegacyPage: vi.fn(async () => ({ id: "p1", spaceId: "space-a" })),
      isMember: vi.fn(async () => true),
      fileSize: vi.fn(async () => 5),
      createAttachment: vi.fn(async () => {
        throw new Error("unique violation");
      }),
    });
    const res = await resolveFileAccess("alt.png", "u1", d);
    expect(res?.id).toBe("att1");
    expect(find).toHaveBeenCalledTimes(2);
  });
});

describe("likeEscape()", () => {
  it("escaped Prozent, Unterstrich und Backslash", () => {
    expect(likeEscape("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
    expect(likeEscape("abc.png")).toBe("abc.png");
  });
});

describe("contentDisposition()", () => {
  it("kodiert Nicht-ASCII nach RFC 5987 mit ASCII-Fallback", () => {
    const h = contentDisposition("attachment", 'Über "Uns" (v2).pdf');
    expect(h).toContain('filename="_ber _Uns_ (v2).pdf"');
    expect(h).toContain("filename*=UTF-8''%C3%9Cber%20%22Uns%22%20%28v2%29.pdf");
    expect(h.startsWith("attachment; ")).toBe(true);
  });

  it("leerer Name -> Fallback", () => {
    expect(contentDisposition("inline", "")).toContain('filename="datei"');
  });
});

describe("fileResponseHeaders()", () => {
  it("Bilder inline, privat gecacht, nosniff", () => {
    const h = fileResponseHeaders(
      { name: "foto.png", mimeType: "image/png" },
      10,
      false,
    );
    expect(h["Content-Type"]).toBe("image/png");
    expect(h["Content-Disposition"]).toMatch(/^inline;/);
    expect(h["Cache-Control"]).toBe("private, max-age=31536000, immutable");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Length"]).toBe("10");
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });

  it("PDF nur mit inline=1 inline, dann in der CSP-Sandbox", () => {
    const att = { name: "a.pdf", mimeType: "application/pdf" };
    expect(fileResponseHeaders(att, 1, false)["Content-Disposition"]).toMatch(
      /^attachment;/,
    );
    const inline = fileResponseHeaders(att, 1, true);
    expect(inline["Content-Disposition"]).toMatch(/^inline;/);
    expect(inline["Content-Security-Policy"]).toBe("sandbox");
  });

  it("alles andere als Download — auch SVG und HTML-artige Typen", () => {
    const svg = fileResponseHeaders(
      { name: "logo.svg", mimeType: "application/octet-stream" },
      1,
      true,
    );
    expect(svg["Content-Disposition"]).toMatch(/^attachment;/);
    const html = fileResponseHeaders(
      { name: "x.html", mimeType: "text/html" },
      1,
      true,
    );
    expect(html["Content-Disposition"]).toMatch(/^attachment;/);
    expect(html["X-Content-Type-Options"]).toBe("nosniff");
  });
});
