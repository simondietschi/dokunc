import { describe, it, expect } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_ACCEPT,
  isInlineImageType,
} from "./image-types";
import { ALLOWED_IMAGE_TYPES as VIA_UPLOADS } from "./uploads";

describe("Bildtypen", () => {
  it("IMAGE_ACCEPT nennt genau die erlaubten Typen", () => {
    // Der Dateidialog darf nichts anbieten, was /api/upload ablehnt —
    // und nichts verschweigen, was erlaubt ist.
    expect(IMAGE_ACCEPT.split(",")).toEqual(Object.keys(ALLOWED_IMAGE_TYPES));
    expect(IMAGE_ACCEPT).toBe("image/png,image/jpeg,image/gif,image/webp");
  });

  it("SVG ist weder erlaubt noch im Dateidialog angeboten", () => {
    expect(ALLOWED_IMAGE_TYPES["image/svg+xml"]).toBeUndefined();
    expect(isInlineImageType("image/svg+xml")).toBe(false);
    expect(IMAGE_ACCEPT).not.toContain("svg");
  });

  it("lib/uploads reicht dieselbe Liste weiter", () => {
    // Zwei Importwege, eine Liste: sonst faellt beim naechsten neuen Typ
    // genau eine der beiden Stellen hinten runter.
    expect(VIA_UPLOADS).toBe(ALLOWED_IMAGE_TYPES);
  });
});
