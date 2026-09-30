// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { FileText } from "lucide-react";
import * as Y from "yjs";
import { editorSchema, schemaHash } from "@dokunc/editor";
import { editorExtensions } from "./editor-extensions";
import { createSlashCommands } from "./SlashCommands";
import { createEntitySuggestion } from "./EntitySuggestion";

/**
 * Der Editor im Browser laedt mehr Erweiterungen als der Collab-Server
 * (NodeViews, Platzhalter, Collaboration, Cursor, Vorschlaege). Die
 * Web-App vergleicht beim Ticket aber nur den Hash des Server-Schemas.
 * Braechte eine Browser-Erweiterung eigene Attribute mit, fiele das dort
 * nicht auf: der Tab schriebe sie ins Dokument, der Server kennte sie
 * nicht. Deshalb hier: das Schema der vollstaendigen Browser-Liste hat
 * denselben Hash wie editorSchema().
 */

const nichts = () => undefined;
const view = () => () => ({});

function vorschlaege() {
  const entity = (name: string, char: string, nodeType: "wikiLink" | "mention") =>
    createEntitySuggestion({
      name,
      char,
      spaceId: "s1",
      kind: nodeType === "wikiLink" ? "pages" : "members",
      nodeType,
      icon: FileText,
      subtitle: "x",
    });
  return [
    createSlashCommands({
      onImage: nichts,
      onMarkdownImport: nichts,
      onAttachment: nichts,
      onPrompt: nichts,
    }),
    entity("wikiLinkSuggestion", "[[", "wikiLink"),
    entity("mentionSuggestion", "@", "mention"),
  ];
}

const views = {
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
};

describe("Erweiterungen des Editors im Browser", () => {
  it("haben verbunden dasselbe Schema wie der Collab-Server", () => {
    const liste = editorExtensions({
      views,
      placeholder: "x",
      collab: {
        ydoc: new Y.Doc(),
        // Fuer das Schema zaehlt nur die Liste; der Provider wird erst
        // beim Aufbau des Editors benutzt.
        provider: {} as HocuspocusProvider,
        user: { name: "x", color: "#000000" },
      },
      vorschlaege: vorschlaege(),
    });
    // Die Liste ist vollstaendig: ohne Collaboration taugte der Vergleich nichts.
    expect(liste.map((e) => e.name)).toEqual(
      expect.arrayContaining([
        "collaboration",
        "collaborationCaret",
        "placeholder",
        "linkClick",
        "slashCommands",
        "wikiLinkSuggestion",
        "mentionSuggestion",
      ]),
    );
    expect(schemaHash(getSchema(liste))).toBe(editorSchema().hash);
  });

  it("haben vor dem Verbinden dasselbe Schema", () => {
    const liste = editorExtensions({
      views,
      placeholder: "x",
      collab: null,
      vorschlaege: vorschlaege(),
    });
    expect(schemaHash(getSchema(liste))).toBe(editorSchema().hash);
  });
});
