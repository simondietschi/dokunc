import { describe, it, expect } from "vitest";
import {
  isSafeFilename,
  contentTypeForFile,
  ALLOWED_IMAGE_TYPES,
  sniffImageType,
  safeExtension,
  sanitizeFilename,
  mimeTypeForExtension,
  isInlineImageType,
  parseMaxUploadMb,
  DEFAULT_MAX_UPLOAD_MB,
} from "./uploads";

describe("upload helpers", () => {
  it("isSafeFilename blockt Path-Traversal", () => {
    expect(isSafeFilename("abc123.png")).toBe(true);
    expect(isSafeFilename("../etc/passwd")).toBe(false);
    expect(isSafeFilename("a/b.png")).toBe(false);
    expect(isSafeFilename("a b.png")).toBe(false);
    expect(isSafeFilename("..")).toBe(false);
  });

  it("contentTypeForFile mappt bekannte Endungen", () => {
    expect(contentTypeForFile("x.png")).toBe("image/png");
    expect(contentTypeForFile("x.jpg")).toBe("image/jpeg");
    expect(contentTypeForFile("x.PDF")).toBe("application/pdf");
    expect(contentTypeForFile("x.exe")).toBe("application/octet-stream");
  });

  it("SVG ist nicht erlaubt (XSS-Schutz)", () => {
    expect(ALLOWED_IMAGE_TYPES["image/svg+xml"]).toBeUndefined();
    expect(ALLOWED_IMAGE_TYPES["image/png"]).toBe("png");
    expect(isInlineImageType("image/svg+xml")).toBe(false);
    expect(isInlineImageType("image/png")).toBe(true);
    expect(isInlineImageType("application/pdf")).toBe(false);
  });

  it("sniffImageType erkennt echte Bilder an Magic Bytes", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const gif = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(gif)).toBe("image/gif");
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("sniffImageType lehnt gefälschte/fremde Inhalte ab", () => {
    // SVG/HTML mit gefälschtem image/png-Header => Inhalt ist kein Bild
    const svg = new TextEncoder().encode("<svg onload=alert(1)></svg>");
    expect(sniffImageType(svg)).toBeNull();
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("mimeTypeForExtension()", () => {
  it("kennt gaengige Dokument-, Archiv- und Medientypen", () => {
    expect(mimeTypeForExtension("pdf")).toBe("application/pdf");
    expect(mimeTypeForExtension("txt")).toBe("text/plain");
    expect(mimeTypeForExtension("md")).toBe("text/markdown");
    expect(mimeTypeForExtension("csv")).toBe("text/csv");
    expect(mimeTypeForExtension("json")).toBe("application/json");
    expect(mimeTypeForExtension("zip")).toBe("application/zip");
    expect(mimeTypeForExtension("docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeTypeForExtension("xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(mimeTypeForExtension("pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(mimeTypeForExtension("odt")).toBe(
      "application/vnd.oasis.opendocument.text",
    );
    expect(mimeTypeForExtension("mp4")).toBe("video/mp4");
    expect(mimeTypeForExtension("mp3")).toBe("audio/mpeg");
    expect(mimeTypeForExtension("PDF")).toBe("application/pdf");
  });

  it("ist konservativ: aktive Inhalte und Unbekanntes -> octet-stream", () => {
    expect(mimeTypeForExtension("html")).toBe("application/octet-stream");
    expect(mimeTypeForExtension("svg")).toBe("application/octet-stream");
    expect(mimeTypeForExtension("js")).toBe("application/octet-stream");
    expect(mimeTypeForExtension("xyz")).toBe("application/octet-stream");
    expect(mimeTypeForExtension("")).toBe("application/octet-stream");
    // Prototyp-Eigenschaften sind keine Endungen
    expect(mimeTypeForExtension("constructor")).toBe(
      "application/octet-stream",
    );
  });
});

describe("safeExtension()", () => {
  it("liefert nur [a-z0-9]{1,8}, sonst bin", () => {
    expect(safeExtension("Bericht.PDF")).toBe("pdf");
    expect(safeExtension("archiv.tar.gz")).toBe("gz");
    expect(safeExtension("daten.7z")).toBe("7z");
    expect(safeExtension("ohne-endung")).toBe("bin");
    expect(safeExtension("leer.")).toBe("bin");
    expect(safeExtension("x.ümlaut")).toBe("bin");
    expect(safeExtension("x.toolangeendung")).toBe("bin");
    expect(safeExtension("x.a b")).toBe("bin");
    expect(safeExtension("../x.php%00")).toBe("bin");
  });
});

describe("sanitizeFilename()", () => {
  it("entfernt Steuerzeichen und Pfadtrenner, kuerzt auf 200", () => {
    expect(sanitizeFilename("Bericht\u0000 Q3\n.pdf")).toBe("Bericht Q3.pdf");
    expect(sanitizeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFilename("  a   b  ")).toBe("a b");
    expect(sanitizeFilename("x".repeat(300))).toHaveLength(200);
    expect(sanitizeFilename("Übersicht ändern.docx")).toBe(
      "Übersicht ändern.docx",
    );
    // Bidi-Steuerzeichen (Endungs-Verschleierung) werden entfernt
    expect(sanitizeFilename("harmlos\u202Efdp.exe")).toBe("harmlosfdp.exe");
  });

  it("leer -> datei", () => {
    expect(sanitizeFilename("")).toBe("datei");
    expect(sanitizeFilename("\u0001\u0002")).toBe("datei");
  });
});

describe("parseMaxUploadMb()", () => {
  it("liest positive ganze Zahlen, sonst Default", () => {
    expect(parseMaxUploadMb("20")).toBe(20);
    expect(parseMaxUploadMb("7.9")).toBe(7);
    expect(parseMaxUploadMb("0")).toBe(DEFAULT_MAX_UPLOAD_MB);
    expect(parseMaxUploadMb("-3")).toBe(DEFAULT_MAX_UPLOAD_MB);
    expect(parseMaxUploadMb("abc")).toBe(DEFAULT_MAX_UPLOAD_MB);
    expect(parseMaxUploadMb("")).toBe(DEFAULT_MAX_UPLOAD_MB);
    expect(parseMaxUploadMb(undefined)).toBe(DEFAULT_MAX_UPLOAD_MB);
    expect(DEFAULT_MAX_UPLOAD_MB).toBe(50);
  });
});
