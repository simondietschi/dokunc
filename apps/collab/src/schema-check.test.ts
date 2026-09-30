import { describe, expect, it } from "vitest";
import { Extension, getSchema } from "@tiptap/core";
import { richExtensions } from "@dokunc/editor";
import { pruefeGegenSchema } from "./schema-check";

/**
 * Pruefung des Seiteninhalts gegen das Editor-Schema, bevor der
 * Collab-Server ihn als Page.content speichert. Mit dem echten Schema.
 *
 * Zwei Stufen, nach dem, was ProseMirror mit dem Inhalt tut:
 *  - nodeFromJSON wirft (unbekannter Knoten, unbekannte Marke, ein
 *    Attribut, dessen Pruefung scheitert): nicht darstellbar. Freigabe,
 *    Export und Druck blieben leer; nicht speichern.
 *  - sonst weicht er nur ab (unbekanntes Attribut, das nodeFromJSON still
 *    verwirft; Inhalt, den check() ablehnt): darstellbar, speichern und
 *    warnen.
 */

const schema = getSchema(richExtensions());

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (text: string, extra: object = {}) => ({
  type: "paragraph",
  ...extra,
  content: [{ type: "text", text }],
});

describe("pruefeGegenSchema()", () => {
  it("laesst gueltigen Inhalt mit allen Blockarten durch", () => {
    const json = doc(
      p("Absatz", { attrs: { textAlign: "center" } }),
      {
        type: "callout",
        attrs: { type: "warning" },
        content: [p("im Callout")],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableHeader", content: [p("Kopf")] }],
          },
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [p("Zelle")] }],
          },
        ],
      },
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [p("erledigt")] },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { userId: "u1", name: "Ada" } },
          { type: "text", text: " und " },
          { type: "wikiLink", attrs: { pageId: "p1", label: "Seite" } },
          {
            type: "text",
            text: " kommentiert",
            marks: [
              { type: "commentMark", attrs: { commentId: "c1" } },
              { type: "highlight", attrs: { color: "#ffee00" } },
            ],
          },
        ],
      },
    );
    expect(pruefeGegenSchema(schema, json)).toBeNull();
  });

  it("ein unbekannter Knoten ist nicht darstellbar", () => {
    const befund = pruefeGegenSchema(
      schema,
      doc(p("vorher"), { type: "zauberknoten", content: [p("innen")] }),
    );
    expect(befund).toMatchObject({
      darstellbar: false,
      unknownNodes: ["zauberknoten"],
      unknownMarks: [],
    });
    expect(befund?.checkError).toMatch(/zauberknoten/);
  });

  it("eine unbekannte Marke ist nicht darstellbar", () => {
    const befund = pruefeGegenSchema(
      schema,
      doc({
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "glitzer" }] }],
      }),
    );
    expect(befund).toMatchObject({
      darstellbar: false,
      unknownNodes: [],
      unknownMarks: ["glitzer"],
    });
  });

  // nodeFromJSON verwirft unbekannte Attribute still; allein fiele es
  // nicht auf. Dargestellt wird trotzdem, also nur eine Warnung.
  it("unbekannte Attribute weichen ab, bleiben aber darstellbar", () => {
    const befund = pruefeGegenSchema(
      schema,
      doc({
        type: "paragraph",
        attrs: { farbe: "rot" },
        content: [
          {
            type: "text",
            text: "x",
            marks: [{ type: "highlight", attrs: { color: "#ffee00", staerke: 3 } }],
          },
        ],
      }),
    );
    expect(befund).toMatchObject({
      darstellbar: true,
      unknownNodes: [],
      unknownMarks: [],
      unknownAttrs: ["highlight.staerke", "paragraph.farbe"],
      checkError: null,
    });
  });

  // Nach gleichzeitigen Aenderungen in Yjs kann eine leere Liste
  // entstehen. generateHTML stellt sie dar, check() lehnt sie ab.
  it("Inhalt, den check() ablehnt, weicht ab und bleibt darstellbar", () => {
    const befund = pruefeGegenSchema(schema, doc({ type: "bulletList", content: [] }));
    expect(befund).toMatchObject({ darstellbar: true, unknownAttrs: [] });
    expect(befund?.checkError).toMatch(/bulletList/);
  });

  // Ein Attribut mit Pruefung (validate) laesst nodeFromJSON werfen,
  // obwohl jeder Name bekannt ist. Dann blieben Freigabe und Export leer.
  it("ein Attributwert, dessen Pruefung scheitert, ist nicht darstellbar", () => {
    const mitPruefung = getSchema([
      ...richExtensions(),
      Extension.create({
        name: "absatzFarbe",
        addGlobalAttributes() {
          return [
            {
              types: ["paragraph"],
              attributes: {
                farbe: {
                  default: null,
                  validate: (v: unknown) => {
                    if (v !== null && !/^#[0-9a-f]{6}$/.test(String(v))) {
                      throw new RangeError("Farbe ungueltig");
                    }
                  },
                },
              },
            },
          ];
        },
      }),
    ]);
    expect(
      pruefeGegenSchema(mitPruefung, doc(p("x", { attrs: { farbe: "#aabbcc" } }))),
    ).toBeNull();
    const befund = pruefeGegenSchema(
      mitPruefung,
      doc(p("x", { attrs: { farbe: "rot" } })),
    );
    expect(befund).toMatchObject({
      darstellbar: false,
      unknownNodes: [],
      unknownMarks: [],
      unknownAttrs: [],
    });
    expect(befund?.checkError).toMatch(/Farbe ungueltig/);
  });

  it("eine Wurzel, die kein doc ist, ist nicht darstellbar", () => {
    expect(pruefeGegenSchema(schema, p("x"))).toMatchObject({
      darstellbar: false,
    });
    expect(pruefeGegenSchema(schema, null)).toMatchObject({ darstellbar: false });
  });

  // Die Namen stammen aus dem Yjs-Dokument, also von jedem, der schreiben
  // darf; sie gehen ins Log.
  it("begrenzt, sortiert und kuerzt die Namen fuers Log", () => {
    const knoten = Array.from({ length: 30 }, (_, i) => ({
      type: `k${String(i).padStart(2, "0")}`,
    }));
    const lang = "x".repeat(10_000);
    const befund = pruefeGegenSchema(schema, doc(...knoten, { type: lang }, knoten[0]));
    expect(befund?.unknownNodes).toHaveLength(20);
    expect(befund?.unknownNodes[0]).toBe("k00");
    expect(befund?.unknownNodes).toEqual([...(befund?.unknownNodes ?? [])].sort());
    const lange = pruefeGegenSchema(schema, doc({ type: lang }));
    expect(lange?.unknownNodes[0]).toHaveLength(64);
    expect(lange?.checkError?.length).toBeLessThanOrEqual(200);
  });
});
