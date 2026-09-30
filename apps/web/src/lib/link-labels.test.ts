import { describe, expect, it } from "vitest";
import { generateText } from "@tiptap/core";
import { richExtensions } from "@dokunc/editor";
import {
  LABEL_OHNE_ZUGRIFF,
  LABEL_VERKNUEPFT,
  istSeitenId,
  resolveLinkLabels,
} from "./link-labels";

/**
 * Beschriftung der Wiki-Links in Ausgaben: der gespeicherte Titel ist ein
 * Schnappschuss und darf nie mehr erscheinen. Sichtbare Ziele bekommen
 * den aktuellen Titel, alle anderen einen festen Text ohne Seiten-ID.
 */

const SICHTBAR = "caaaaaaaaaaaaaaaaaaaaaaaa";
const GESPERRT = "cbbbbbbbbbbbbbbbbbbbbbbbb";
const UNBEKANNT = "ccccccccccccccccccccccccc";

const link = (pageId: string | null, label: string | null) => ({
  type: "wikiLink",
  attrs: { pageId, label },
});

function doc() {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Siehe ", marks: [{ type: "bold" }] },
          link(SICHTBAR, "Alter Titel"),
          link(GESPERRT, "Kündigung M. Muster"),
          link(UNBEKANNT, "Gelöscht"),
          link(null, "Ohne Ziel"),
          { type: "mention", attrs: { userId: "u1", name: "Alex" } },
        ],
      },
    ],
  };
}

const titel = new Map<string, string | null>([
  [SICHTBAR, "Vertrag 2026"],
  [GESPERRT, null],
]);

type Knoten = { type: string; attrs?: Record<string, unknown>; text?: string; marks?: unknown };
const inline = (d: unknown) =>
  (d as { content: { content: Knoten[] }[] }).content[0].content;

describe("resolveLinkLabels()", () => {
  it("setzt den aktuellen Titel sichtbarer Ziele und behält die ID", () => {
    const [, sichtbar] = inline(resolveLinkLabels(doc(), titel, { stripIds: false }));
    expect(sichtbar.attrs).toEqual({ pageId: SICHTBAR, label: "Vertrag 2026" });
  });

  it("gesperrte, unbekannte und ziellose Links: fester Text, keine ID", () => {
    const [, , gesperrt, unbekannt, ohne] = inline(
      resolveLinkLabels(doc(), titel, { stripIds: false }),
    );
    for (const k of [gesperrt, unbekannt, ohne]) {
      expect(k.attrs).toEqual({ pageId: null, label: LABEL_OHNE_ZUGRIFF });
    }
  });

  it("stripIds: auch sichtbare Ziele ohne ID, Erwähnungen ohne Personen-ID", () => {
    const [text, sichtbar, , , , erwaehnung] = inline(
      resolveLinkLabels(doc(), titel, { stripIds: true }),
    );
    expect(sichtbar.attrs).toEqual({ pageId: null, label: "Vertrag 2026" });
    expect(erwaehnung.attrs).toEqual({ userId: null, name: "Alex" });
    // Text und Marken bleiben, wie sie waren.
    expect(text).toEqual({ type: "text", text: "Siehe ", marks: [{ type: "bold" }] });
  });

  it("ohne stripIds bleibt die Erwähnung unverändert", () => {
    const erwaehnung = inline(resolveLinkLabels(doc(), titel, { stripIds: false }))[5];
    expect(erwaehnung.attrs).toEqual({ userId: "u1", name: "Alex" });
  });

  it("eigener Text für Ziele ohne Titel (Freigabe)", () => {
    const [, , gesperrt] = inline(
      resolveLinkLabels(doc(), titel, { stripIds: true, ohneTitel: LABEL_VERKNUEPFT }),
    );
    expect(gesperrt.attrs).toEqual({ pageId: null, label: LABEL_VERKNUEPFT });
  });

  it("verändert die Eingabe nicht und lässt keinen Schnappschuss übrig", () => {
    const eingabe = doc();
    const vorher = JSON.stringify(eingabe);
    const aus = JSON.stringify(resolveLinkLabels(eingabe, titel, { stripIds: true }));
    expect(JSON.stringify(eingabe)).toBe(vorher);
    for (const alt of ["Alter Titel", "Kündigung", "Gelöscht", "Ohne Ziel"]) {
      expect(aus).not.toContain(alt);
    }
  });

  it("nimmt jeden Wert an, ohne zu werfen", () => {
    expect(resolveLinkLabels(null, titel, { stripIds: true })).toBeNull();
    expect(resolveLinkLabels("x", titel, { stripIds: true })).toBe("x");
    expect(
      resolveLinkLabels({ type: "wikiLink" }, titel, { stripIds: false }),
    ).toEqual({ type: "wikiLink", attrs: { pageId: null, label: LABEL_OHNE_ZUGRIFF } });
  });
});

describe("istSeitenId()", () => {
  it("nimmt IDs der Datenbank an", () => {
    expect(istSeitenId("cmg1y2z3a0000abcdxyz12345")).toBe(true);
    expect(istSeitenId(SICHTBAR)).toBe(true);
  });

  it("lehnt alles andere ab", () => {
    for (const v of ["", "kurz", "GROSS0000000", "a/b0000000", "a".repeat(65), null, 42]) {
      expect(istSeitenId(v)).toBe(false);
    }
  });
});

describe("Wiki-Link als Text (Zwischenablage)", () => {
  it("ohne gespeicherten Titel steht „Seite“, nie „null“", () => {
    const text = generateText(
      { type: "doc", content: [{ type: "paragraph", content: [link(SICHTBAR, null)] }] },
      richExtensions(),
    );
    expect(text).toBe("[[Seite]]");
  });
});
