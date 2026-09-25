import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { COLLAB_FIELD } from "@dokunc/editor";

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
