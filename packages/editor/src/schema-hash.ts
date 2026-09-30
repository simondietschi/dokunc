/**
 * Kennung des Editor-Schemas: ein Hash ueber alles am ProseMirror-Schema,
 * was die Yjs-Daten betrifft.
 *
 * Warum: Ein Editor mit anderem Schema als seine Mitschreibenden loescht
 * beim Laden aus dem gemeinsamen Dokument, was er nicht kennt. Die
 * Yjs-Bindung (@tiptap/y-tiptap) entfernt ein Element, aus dem sie keinen
 * Knoten bauen kann, und bei einer unbekannten Marke den ganzen Textlauf;
 * Attribute, die ihr Schema nicht fuehrt, streicht sie beim naechsten
 * Schreiben. Die Loeschung geht an alle und in die Datenbank. Browser,
 * Web-App und Collab-Server vergleichen deshalb diesen Hash, bevor ein
 * Tab abgleichen darf.
 *
 * Im Fingerabdruck steht, was darueber entscheidet, ob ein Element aus
 * dem Dokument als Knoten oder Marke zustande kommt und welche Attribute
 * es behaelt: Namen, Inhaltsausdruecke, erlaubte Marken, Gruppen,
 * inline/atom, Attribute samt Vorgabewert und Pruefausdruck. Der
 * Vorgabewert zaehlt mit, weil die Bindung ihn ins Dokument
 * zurueckschreibt, wenn das Attribut dort fehlt: zwei Fassungen mit
 * verschiedenen Vorgaben ueberschrieben sich gegenseitig. Funktionen
 * (parseDOM, toDOM, NodeViews, Plugins) stehen nicht darin; sie aendern
 * nichts an den Daten, und der Collab-Server laesst NodeViews weg.
 *
 * Keine Laufzeit-Importe ausser dem Feldnamen: das Modul laeuft auch im
 * Browser. Bewusst ohne Web Crypto: crypto.subtle fehlt auf Seiten, die
 * ueber http:// ausgeliefert werden (Betrieb im LAN).
 */

import type { getSchema } from "@tiptap/core";
import { COLLAB_FIELD } from "./collab-protocol";

type Schema = ReturnType<typeof getSchema>;

/** Attributbeschreibung, wie sie im Schema steht. */
type AttributSpec = { default?: unknown; validate?: unknown };

const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const MASKE_64 = BigInt("0xffffffffffffffff");

/**
 * FNV-1a mit 64 Bit ueber die UTF-8-Bytes von `text`, als 16
 * Hexziffern. Keine kryptografische Funktion: sie soll nur Fassungen
 * unterscheiden, nicht gegen Faelschung schuetzen (der Hash steht ohnehin
 * in jedem ausgelieferten Editor).
 */
export function fnv1a64(text: string): string {
  let h = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * FNV_PRIME) & MASKE_64;
  }
  return h.toString(16).padStart(16, "0");
}

/** Attribute nach Namen sortiert, mit Vorgabe (oder Pflicht) und Pruefausdruck. */
function attribute(spec: Record<string, AttributSpec> | undefined): unknown[] {
  if (!spec) return [];
  return Object.keys(spec)
    .sort()
    .map((name) => {
      const a = spec[name];
      return [
        name,
        "default" in a ? a.default : "<pflicht>",
        typeof a.validate === "string" ? a.validate : null,
      ];
    });
}

/**
 * Kanonische Beschreibung des Schemas als JSON-Text. Knoten und Marken in
 * der Reihenfolge des Schemas: sie entscheidet mit, welche Regel beim
 * Einlesen greift, und ist bei gleichem Code immer dieselbe.
 */
export function schemaFingerprint(schema: Schema): string {
  const nodes: unknown[] = [];
  schema.spec.nodes.forEach((name, spec) => {
    nodes.push([
      name,
      spec.content ?? "",
      spec.marks ?? null,
      spec.group ?? "",
      !!spec.inline,
      !!spec.atom,
      attribute(spec.attrs as Record<string, AttributSpec> | undefined),
    ]);
  });
  const marks: unknown[] = [];
  schema.spec.marks.forEach((name, spec) => {
    marks.push([
      name,
      spec.excludes ?? null,
      spec.inclusive ?? null,
      spec.spanning ?? null,
      spec.group ?? "",
      attribute(spec.attrs as Record<string, AttributSpec> | undefined),
    ]);
  });
  return JSON.stringify({
    f: COLLAB_FIELD,
    top: schema.spec.topNode ?? "doc",
    nodes,
    marks,
  });
}

/** Hash des Schemas: fnv1a64 ueber schemaFingerprint, 16 Hexziffern. */
export function schemaHash(schema: Schema): string {
  return fnv1a64(schemaFingerprint(schema));
}
