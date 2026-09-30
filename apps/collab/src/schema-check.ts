import type { getSchema } from "@tiptap/core";

/**
 * Pruefung des Seiteninhalts gegen das Editor-Schema, bevor der
 * Collab-Server ihn als Page.content speichert.
 *
 * Der Inhalt kommt aus dem Yjs-Dokument (TiptapTransformer.fromYdoc),
 * und diese Umwandlung kennt kein Schema: was ein Browser mit anderem
 * oder manipuliertem Editor dort hineinschreibt, landete sonst
 * ungeprueft in Page.content. Aus Page.content entstehen Suche,
 * Freigabe, Export, Druck und Versionen; ein Knoten, den das Schema nicht
 * kennt, liesse Freigabe und Export leer ausgeben (contentToHtml faengt
 * den Fehler und liefert '').
 *
 * Eingestuft wird nach dem, was ProseMirror tut, nicht nach einer eigenen
 * Liste:
 *  - `schema.nodeFromJSON` wirft: nicht darstellbar. Das trifft
 *    unbekannte Knoten und Marken, aber auch Attributwerte, deren
 *    Pruefung (`validate`) scheitert, und leere Textknoten. Genau dann
 *    scheitern auch generateHTML und contentToHtml.
 *  - Sonst weicht der Inhalt hoechstens ab: Attribute, die das Schema
 *    nicht fuehrt (nodeFromJSON verwirft sie still), oder Inhalt, den
 *    `check()` ablehnt (etwa eine leere Liste nach gleichzeitigen
 *    Aenderungen). Dargestellt wird er trotzdem.
 *
 * Der Durchlauf sammelt nur die Namen fuers Log. Sie stammen aus dem
 * Dokument, also von jedem, der schreiben darf: hoechstens 20 je Liste,
 * jeder auf 64 Zeichen gekuerzt, die Fehlermeldung auf 200.
 */

type Schema = ReturnType<typeof getSchema>;

export type SchemaBefund = {
  /** false: nodeFromJSON wirft, der Inhalt liesse sich nicht darstellen. */
  darstellbar: boolean;
  /** Knotentypen, die das Schema nicht kennt. */
  unknownNodes: string[];
  /** Markentypen, die das Schema nicht kennt. */
  unknownMarks: string[];
  /** Attribute bekannter Typen, die das Schema nicht fuehrt ("typ.name"). */
  unknownAttrs: string[];
  /** Meldung von nodeFromJSON oder check(), null ohne. */
  checkError: string | null;
};

const MAX_NAMEN = 20;
const MAX_NAME = 64;
const MAX_MELDUNG = 200;

type JsonKnoten = {
  type?: unknown;
  attrs?: unknown;
  content?: unknown;
  marks?: unknown;
};

function istObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Eindeutig, sortiert, begrenzt. */
function liste(namen: Set<string>): string[] {
  return [...namen].sort().slice(0, MAX_NAMEN);
}

function name(v: unknown): string {
  return String(v).slice(0, MAX_NAME);
}

/** Attributnamen, die nicht in `deklariert` stehen, als "typ.name". */
function fremdeAttribute(
  typ: string,
  attrs: unknown,
  deklariert: Record<string, unknown> | undefined,
  ziel: Set<string>,
): void {
  if (!istObjekt(attrs)) return;
  for (const key of Object.keys(attrs)) {
    if (!deklariert || !(key in deklariert)) {
      ziel.add(name(`${typ}.${key}`));
    }
  }
}

/**
 * Inhalt gegen `schema` pruefen. null, wenn er in Ordnung ist; sonst der
 * Befund (Stufe in `darstellbar`).
 */
export function pruefeGegenSchema(
  schema: Schema,
  json: unknown,
): SchemaBefund | null {
  const knoten = new Set<string>();
  const marken = new Set<string>();
  const attribute = new Set<string>();

  // Iterativ: die Tiefe bestimmt, wer schreiben darf.
  const offen: unknown[] = [json];
  while (offen.length > 0) {
    const n = offen.pop() as JsonKnoten;
    if (!istObjekt(n)) continue;
    const typ = typeof n.type === "string" ? n.type : "";
    const nodeType = schema.nodes[typ];
    if (!nodeType) {
      knoten.add(name(typ));
    } else {
      fremdeAttribute(typ, n.attrs, nodeType.spec.attrs, attribute);
    }
    if (Array.isArray(n.marks)) {
      for (const m of n.marks) {
        if (!istObjekt(m)) continue;
        const mtyp = typeof m.type === "string" ? m.type : "";
        const markType = schema.marks[mtyp];
        if (!markType) {
          marken.add(name(mtyp));
        } else {
          fremdeAttribute(mtyp, m.attrs, markType.spec.attrs, attribute);
        }
      }
    }
    if (Array.isArray(n.content)) {
      for (const kind of n.content) offen.push(kind);
    }
  }

  let darstellbar = true;
  let checkError: string | null = null;
  try {
    if (!istObjekt(json) || json.type !== schema.topNodeType.name) {
      throw new RangeError(
        `Wurzel ist nicht ${schema.topNodeType.name}: ${name(istObjekt(json) ? json.type : json)}`,
      );
    }
    const node = schema.nodeFromJSON(json);
    try {
      node.check();
    } catch (e) {
      checkError = meldung(e);
    }
  } catch (e) {
    darstellbar = false;
    checkError = meldung(e);
  }

  if (darstellbar && checkError === null && attribute.size === 0) return null;
  return {
    darstellbar,
    unknownNodes: liste(knoten),
    unknownMarks: liste(marken),
    unknownAttrs: liste(attribute),
    checkError,
  };
}

function meldung(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, MAX_MELDUNG);
}
