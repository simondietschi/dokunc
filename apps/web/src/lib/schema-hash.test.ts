import { describe, expect, it } from "vitest";
import { Extension, getSchema, type AnyExtension } from "@tiptap/core";
import {
  EDITOR_SCHEMA_HASHES,
  editorSchema,
  fnv1a64,
  richExtensions,
  schemaHash,
} from "@dokunc/editor";

/**
 * Schema-Hash des Editors (packages/editor/src/schema-hash.ts).
 *
 * Browser, Web-App und Collab-Server vergleichen diesen Hash, bevor ein
 * Tab abgleichen darf: ein Editor mit anderem Schema loescht beim Laden
 * alles, was er nicht kennt, aus dem gemeinsamen Dokument. Der Hash muss
 * deshalb genau das erfassen, was die Yjs-Daten betrifft (Knoten,
 * Marken, Attribute samt Vorgabewerten, Inhaltsausdruecke), und nichts
 * sonst (NodeViews, Plugins). Dass die Browser-Erweiterungen das Schema
 * nicht aendern, prueft components/editor/editor-extensions.test.ts.
 */

const hashVon = (extensions: AnyExtension[]) =>
  schemaHash(getSchema(extensions));

/** Eine Erweiterung aus richExtensions() ersetzen, ohne die Reihenfolge zu aendern. */
function ersetze(
  name: string,
  neu: (alt: AnyExtension) => AnyExtension,
): AnyExtension[] {
  const liste = richExtensions() as AnyExtension[];
  expect(liste.some((e) => e.name === name)).toBe(true);
  return liste.map((e) => (e.name === name ? neu(e) : e));
}

describe("fnv1a64", () => {
  // Veroeffentlichte Pruefwerte von FNV-1a mit 64 Bit.
  it("liefert die bekannten Pruefwerte", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
  });
});

describe("editorSchema", () => {
  it("liefert 16 Hexziffern, stabil und aus richExtensions() abgeleitet", () => {
    const a = editorSchema();
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(editorSchema()).toEqual(a);
    expect(a.hash).toBe(hashVon(richExtensions() as AnyExtension[]));
  });

  it("aendert sich nicht durch NodeViews (die der Browser mitgibt, der Server nicht)", () => {
    const view = () => () => ({});
    const mitViews = richExtensions({
      attachment: view,
      callout: view,
      toggle: view,
      codeBlock: view,
      image: view,
      mermaid: view,
      wikiLink: view,
      mention: view,
      excalidraw: view,
      drawio: view,
    });
    expect(hashVon(mitViews as AnyExtension[])).toBe(editorSchema().hash);
  });

  describe("erfasst alles, was die Yjs-Daten betrifft", () => {
    const eigen = () => editorSchema().hash;

    it("einen fehlenden Knoten", () => {
      const ohne = (richExtensions() as AnyExtension[]).filter(
        (e) => e.name !== "callout",
      );
      expect(hashVon(ohne)).not.toBe(eigen());
    });

    it("eine fehlende Marke", () => {
      const ohne = (richExtensions() as AnyExtension[]).filter(
        (e) => e.name !== "highlight",
      );
      expect(hashVon(ohne)).not.toBe(eigen());
    });

    it("ein zusaetzliches Attribut an einem bestehenden Knoten", () => {
      const farbe = Extension.create({
        name: "absatzFarbe",
        addGlobalAttributes() {
          return [
            { types: ["paragraph"], attributes: { farbe: { default: null } } },
          ];
        },
      });
      expect(
        hashVon([...(richExtensions() as AnyExtension[]), farbe]),
      ).not.toBe(eigen());
    });

    it("einen geaenderten Vorgabewert", () => {
      // y-tiptap schreibt den Vorgabewert zurueck ins Dokument, wenn das
      // Attribut dort fehlt: zwei Fassungen mit verschiedenen Vorgaben
      // ueberschrieben sich gegenseitig.
      const liste = ersetze("mermaid", (alt) =>
        (alt as unknown as {
          extend: (c: object) => AnyExtension;
        }).extend({
          addAttributes() {
            return {
              ...(this as { parent?: () => object }).parent?.(),
              code: { default: "graph LR" },
            };
          },
        }),
      );
      expect(hashVon(liste)).not.toBe(eigen());
    });

    it("einen geaenderten Inhaltsausdruck", () => {
      // Passt der Inhalt nicht zum Ausdruck, wirft ProseMirror beim
      // Aufbau des Knotens, und y-tiptap loescht ihn ebenfalls.
      const liste = ersetze("callout", (alt) =>
        (alt as unknown as {
          extend: (c: object) => AnyExtension;
        }).extend({ content: "paragraph+" }),
      );
      expect(hashVon(liste)).not.toBe(eigen());
    });
  });
});

describe("EDITOR_SCHEMA_HASHES", () => {
  it("fuehrt das heutige Schema als juengsten Eintrag", () => {
    const { hash, version } = editorSchema();
    expect(
      EDITOR_SCHEMA_HASHES.at(-1),
      "Editor-Schema geaendert: neuen Hash an EDITOR_SCHEMA_HASHES anhaengen (nicht ersetzen) und im CHANGELOG unter Upgrade notes vermerken",
    ).toBe(hash);
    expect(version).toBe(EDITOR_SCHEMA_HASHES.length);
  });

  it("enthaelt jeden Hash nur einmal und nur in der Form des Hashes", () => {
    expect(new Set(EDITOR_SCHEMA_HASHES).size).toBe(EDITOR_SCHEMA_HASHES.length);
    for (const h of EDITOR_SCHEMA_HASHES) expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  // Zweite Abschrift der Liste, damit "nur anhaengen" pruefbar ist. Jede
  // Installation, die ein Schema schon gefahren hat, hat dessen Version
  // und Hash in ihrer Marke (InstanceState). Wuerde ein Eintrag ersetzt
  // statt ein neuer angehaengt, haette der naechste Collab-Server dort
  // dieselbe Version mit anderem Hash, gaelte als veraltet und naehme
  // keinen Editor an.
  const EINGETRAGEN = ["e4d7324972931cd1"];

  it("aendert keinen eingetragenen Hash und haengt neue nur an", () => {
    expect(
      EDITOR_SCHEMA_HASHES.slice(0, EINGETRAGEN.length),
      "Eintraege in EDITOR_SCHEMA_HASHES nie aendern, entfernen oder umstellen, nur anhaengen",
    ).toEqual(EINGETRAGEN);
    expect(
      EDITOR_SCHEMA_HASHES.length,
      "Neuen Hash auch hier an EINGETRAGEN anhaengen",
    ).toBe(EINGETRAGEN.length);
  });
});
