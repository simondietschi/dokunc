import { HocuspocusProvider } from "@hocuspocus/provider";
import { getSchema, type AnyExtension } from "@tiptap/core";
import { Transform } from "@tiptap/pm/transform";
import { initProseMirrorDoc, updateYFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { prisma } from "@dokunc/db";
import { COLLAB_FIELD, richExtensions, schemaHash } from "@dokunc/editor";

/**
 * Gemeinsame Hilfen fuer Pruefstaende mit echtem Collab-Server (siehe
 * ./collab-pruefserver): tippen wie im Editor, den Inhalt lesen, auf
 * einen Zustand warten und eine Editor-Verbindung aufbauen.
 *
 * Vorbild ist restore-version-collab.test.ts (dort bleiben die eigenen
 * Fassungen stehen). Hier parametrisiert: Adresse, Seite und Ticket
 * kommen vom Test, das Aufraeumen der Provider bleibt beim Test.
 */

/** Tippen wie im Editor: einen Absatz ans Ende setzen. */
export function tippe(doc: Y.Doc, text: string): void {
  const element = new Y.XmlElement("paragraph");
  const knoten = new Y.XmlText();
  knoten.insert(0, text);
  element.insert(0, [knoten]);
  doc.getXmlFragment(COLLAB_FIELD).push([element]);
}

/** Das Dokument als Text, wie es im Yjs-Feld des Editors steht. */
export function inhalt(doc: Y.Doc): string {
  return doc.getXmlFragment(COLLAB_FIELD).toString();
}

/**
 * Der gespeicherte Yjs-Stand einer Seite (CollabDocument) als Text wie
 * `inhalt`; "" ohne Zeile oder bei unlesbarem Stand.
 */
export async function textImCollabDocument(pageId: string): Promise<string> {
  const row = await prisma.collabDocument.findUnique({
    where: { pageId },
    select: { state: true },
  });
  if (!row) return "";
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(row.state));
  } catch {
    return "";
  }
  return inhalt(doc);
}

/** Page.content einer Seite als JSON-Text. */
export async function textInPageContent(pageId: string): Promise<string> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { content: true },
  });
  return JSON.stringify(page?.content ?? null);
}

/**
 * Wartet, bis `bedingung` wahr ist. Sonst ein Fehler mit `was` und, falls
 * gegeben, dem Log des Servers (`log`).
 */
export async function warteBis(
  bedingung: () => Promise<boolean> | boolean,
  was: string,
  opts: { timeoutMs?: number; takt?: number; log?: () => string } = {},
): Promise<void> {
  const { timeoutMs = 15_000, takt = 100, log } = opts;
  const ende = Date.now() + timeoutMs;
  while (Date.now() < ende) {
    if (await bedingung()) return;
    await new Promise((r) => setTimeout(r, takt));
  }
  throw new Error(
    `Zeitlimit: ${was}${log ? `\n--- Collab-Log ---\n${log()}` : ""}`,
  );
}

/**
 * Editor-Verbindung wie im Browser, optional mit mitgebrachtem Stand
 * (Kopie aus IndexedDB). Wartet bis zur ersten Synchronisation, wenn
 * `warteAufSync` nicht false ist.
 */
export async function verbinde(opts: {
  url: string;
  pageId: string;
  ticket: () => Promise<string>;
  mitgebracht?: Uint8Array;
  onStateless?: (payload: string) => void;
  onClose?: (code: number | undefined) => void;
  extra?: Partial<ConstructorParameters<typeof HocuspocusProvider>[0]>;
  /** Vorgabe true. */
  warteAufSync?: boolean;
  timeoutMs?: number;
}): Promise<{ doc: Y.Doc; provider: HocuspocusProvider }> {
  const doc = new Y.Doc();
  if (opts.mitgebracht) Y.applyUpdate(doc, opts.mitgebracht);
  let synced = false;
  const provider = new HocuspocusProvider({
    ...opts.extra,
    url: opts.url,
    name: opts.pageId,
    document: doc,
    token: opts.ticket,
    onSynced: () => {
      synced = true;
    },
    onStateless: ({ payload }) => opts.onStateless?.(payload),
    onClose: ({ event }) => opts.onClose?.(event?.code),
  } as ConstructorParameters<typeof HocuspocusProvider>[0]);
  if (opts.warteAufSync !== false) {
    try {
      await warteBis(() => synced, "Editor synchronisiert", {
        timeoutMs: opts.timeoutMs,
      });
    } catch (e) {
      provider.destroy();
      throw e;
    }
  }
  return { doc, provider };
}

/**
 * Schema eines aelteren Editors: richExtensions() ohne die genannten
 * Erweiterungen (Namen wie "callout", "highlight", "textAlign"), dazu
 * sein Hash, wie ihn ein solcher Tab schickte.
 */
export function schemaOhne(namen: string[]): {
  schema: ReturnType<typeof getSchema>;
  hash: string;
} {
  const liste = (richExtensions() as AnyExtension[]).filter(
    (e) => !namen.includes(e.name),
  );
  if (liste.length !== richExtensions().length - namen.length) {
    throw new Error(`Nicht alle Erweiterungen gefunden: ${namen.join(", ")}`);
  }
  const schema = getSchema(liste);
  return { schema, hash: schemaHash(schema) };
}

/**
 * Was ein Editor mit `schema` im Browser mit dem Dokument macht, genau
 * mit der Bindung des Browsers (@tiptap/y-tiptap):
 *
 *  1. Beim Anzeigen baut initProseMirrorDoc den Editorinhalt aus dem
 *     Yjs-Feld. Elemente, aus denen mit diesem Schema kein Knoten wird,
 *     loescht die Bindung dabei aus dem Dokument, bei einer unbekannten
 *     Marke den ganzen Textlauf.
 *  2. Tippt die Person danach in den Absatz, der `tippeIn` enthaelt,
 *     gleicht updateYFragment den Absatz ab wie nach jeder Eingabe und
 *     entfernt dabei Attribute, die das Schema nicht kennt.
 *
 * Die Aenderungen landen im Y.Doc; ein verbundener Provider schickt sie
 * an den Server. Ergebnis: ob es den Absatz zum Tippen gab (ein nie
 * abgeglichenes Dokument ist leer).
 */
export function wieAlterEditor(
  doc: Y.Doc,
  schema: ReturnType<typeof getSchema>,
  tippeIn?: string,
): boolean {
  const fragment = doc.getXmlFragment(COLLAB_FIELD);
  const { doc: pmDoc, meta } = initProseMirrorDoc(fragment, schema);
  if (!tippeIn) return false;
  let ende = -1;
  pmDoc.descendants((node, pos) => {
    if (ende < 0 && node.isTextblock && node.textContent.includes(tippeIn)) {
      ende = pos + node.nodeSize - 1;
    }
    return ende < 0;
  });
  if (ende < 0) return false;
  const neu = new Transform(pmDoc).insert(ende, schema.text("!")).doc;
  doc.transact(() => updateYFragment(doc, fragment, neu, meta));
  return true;
}
