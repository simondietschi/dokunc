import { describe, it, expect } from "vitest";
import { formatFileSize, fileIconKind, fileExtension } from "./file-meta";

describe("formatFileSize()", () => {
  it("formatiert Bytes, KB, MB und GB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(48_200)).toBe("47 KB");
    expect(formatFileSize(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatFileSize(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatFileSize(1.25 * 1024 ** 3)).toBe("1.3 GB");
  });

  it("ist robust gegen ungueltige Werte", () => {
    expect(formatFileSize(-5)).toBe("0 B");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("fileExtension()", () => {
  it("liefert die Endung klein und ohne Punkt", () => {
    expect(fileExtension("Bericht.PDF")).toBe("pdf");
    expect(fileExtension("archiv.tar.gz")).toBe("gz");
    expect(fileExtension("ohne-endung")).toBe("");
    expect(fileExtension("endet-mit-punkt.")).toBe("");
  });
});

describe("fileIconKind()", () => {
  it("waehlt nach MIME-Typ", () => {
    expect(fileIconKind("image/png")).toBe("image");
    expect(fileIconKind("application/pdf")).toBe("pdf");
    expect(fileIconKind("text/plain")).toBe("text");
    expect(fileIconKind("text/csv")).toBe("spreadsheet");
    expect(
      fileIconKind(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("spreadsheet");
    expect(
      fileIconKind(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("presentation");
    expect(fileIconKind("application/zip")).toBe("archive");
    expect(fileIconKind("audio/mpeg")).toBe("audio");
    expect(fileIconKind("video/mp4")).toBe("video");
    expect(fileIconKind("application/json")).toBe("code");
    expect(
      fileIconKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("text");
  });

  it("faellt auf die Endung zurueck, wenn der MIME-Typ nichts sagt", () => {
    expect(fileIconKind("application/octet-stream", "daten.xlsx")).toBe(
      "spreadsheet",
    );
    expect(fileIconKind("application/octet-stream", "folien.key")).toBe(
      "presentation",
    );
    expect(fileIconKind("application/octet-stream", "backup.7z")).toBe(
      "archive",
    );
    expect(fileIconKind("application/octet-stream", "config.yaml")).toBe(
      "code",
    );
    expect(fileIconKind("", "unbekannt.xyz")).toBe("file");
    expect(fileIconKind("application/octet-stream")).toBe("file");
  });
});
