import { describe, it, expect } from "vitest";
import {
  isSafeFilename,
  contentTypeForFile,
  ALLOWED_IMAGE_TYPES,
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
});
