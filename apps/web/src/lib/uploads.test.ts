import { describe, it, expect } from "vitest";
import {
  contentDisposition,
  isInlineType,
  safeDisplayName,
} from "./uploads";
import {
  isSafeFilename,
  contentTypeForFile,
  ALLOWED_IMAGE_TYPES,
  sniffImageType,
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
    expect(contentTypeForFile("x.exe")).toBe("application/octet-stream");
  });

  it("SVG ist nicht erlaubt (XSS-Schutz)", () => {
    expect(ALLOWED_IMAGE_TYPES["image/svg+xml"]).toBeUndefined();
    expect(ALLOWED_IMAGE_TYPES["image/png"]).toBe("png");
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

describe("Anhang-Auslieferung", () => {
  it("liefert nur bekannte, harmlose Typen inline aus", () => {
    expect(isInlineType("image/png")).toBe(true);
    expect(isInlineType("application/pdf")).toBe(true);
    // Beide könnten sonst Skripte im Ursprung der App ausführen.
    expect(isInlineType("image/svg+xml")).toBe(false);
    expect(isInlineType("text/html")).toBe(false);
    expect(isInlineType("application/octet-stream")).toBe(false);
  });

  it("räumt Pfadanteile und Steuerzeichen aus dem Anzeigenamen", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName('C:\\Temp\\bericht.pdf')).toBe("bericht.pdf");
    expect(safeDisplayName('a"b.txt')).toBe("ab.txt");
    expect(safeDisplayName("   ")).toBe("datei");
  });

  it("kodiert den Dateinamen in Content-Disposition", () => {
    const header = contentDisposition("Jahresbericht 2026.pdf", true);
    expect(header.startsWith("inline;")).toBe(true);
    expect(header).toContain('filename="Jahresbericht 2026.pdf"');

    const umlaut = contentDisposition("Übersicht.csv", false);
    expect(umlaut.startsWith("attachment;")).toBe(true);
    // ASCII-Fallback plus RFC-5987-Variante.
    expect(umlaut).toContain('filename="_bersicht.csv"');
    expect(umlaut).toContain("filename*=UTF-8''%C3%9Cbersicht.csv");
  });
});
