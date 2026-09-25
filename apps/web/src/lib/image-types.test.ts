import { describe, it, expect } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_ACCEPT,
  IMAGE_TYPE_NAMES,
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

  it("IMAGE_TYPE_NAMES zaehlt die erlaubten Typen fuer Meldungen auf", () => {
    // Genau dieser Text steht in den Meldungen von api/upload, Editor
    // und Import — frueher dreimal von Hand.
    expect(IMAGE_TYPE_NAMES).toBe("PNG, JPG, GIF und WebP");
  });

  it("IMAGE_TYPE_NAMES nennt jede erlaubte Endung genau einmal", () => {
    // Kommt ein Typ zur Liste hinzu, muss er in den Meldungen auftauchen,
    // ohne dass jemand die Texte anfasst. Als sortierte Liste verglichen,
    // nicht als Menge: sonst bestuende auch "PNG, JPG, JPG, GIF und WebP".
    const names = IMAGE_TYPE_NAMES.toLowerCase().split(/, | und /).sort();
    const endungen = [...new Set(Object.values(ALLOWED_IMAGE_TYPES))].sort();
    expect(names).toEqual(endungen);
  });

  it("lib/uploads reicht dieselbe Liste weiter", () => {
    // Zwei Importwege, eine Liste: sonst faellt beim naechsten neuen Typ
    // genau eine der beiden Stellen hinten runter.
    expect(VIA_UPLOADS).toBe(ALLOWED_IMAGE_TYPES);
  });
});
