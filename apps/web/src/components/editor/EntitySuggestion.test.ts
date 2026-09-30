import { describe, expect, it } from "vitest";
import { entityAttrs } from "./EntitySuggestion";

/**
 * Was ein gewählter Vorschlag in das Dokument schreibt. Der Titel einer
 * Seite gehört nicht dazu: er stünde sonst als Schnappschuss bei allen,
 * die die verlinkende Seite lesen, auch nachdem das Ziel geschützt oder
 * umbenannt wurde. Die Anzeige holt den aktuellen Titel selbst.
 */
describe("entityAttrs()", () => {
  it("Wiki-Link: nur die Seiten-ID, kein Titel", () => {
    expect(entityAttrs("wikiLink", { id: "p1", label: "Kündigung M. Muster" })).toEqual({
      pageId: "p1",
      label: null,
    });
  });

  it("Erwähnung: ID und Name wie bisher", () => {
    expect(entityAttrs("mention", { id: "u1", label: "Alex" })).toEqual({
      userId: "u1",
      name: "Alex",
    });
  });
});
