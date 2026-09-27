/*
 * Reine Regeln der Aenderungsmeldung (PAGE_UPDATED): wer sie bekommen
 * kann und ob sich der Inhalt ueberhaupt geaendert hat. Die Abfragen
 * dazu stehen in ./server (onStoreDocument, pageUpdateRecipients).
 */

/** Marken dieses Typs zaehlen beim Vergleich nicht (Kommentar-Threads). */
const COMMENT_MARK = "commentMark";

/**
 * Folgende, die eine Aenderungsmeldung bekommen koennen: ohne Mitwirkende
 * und ohne die in diesem Lauf neu Erwaehnten (die Erwaehnung fuehrt schon
 * zur Seite). Reihenfolge der Folgenden, ohne Doppelte.
 */
export function pageUpdateCandidates(
  followers: readonly string[],
  contributors: ReadonlySet<string>,
  mentioned: readonly string[],
): string[] {
  const skip = new Set<string>([...contributors, ...mentioned]);
  const out: string[] = [];
  for (const userId of followers) {
    if (skip.has(userId)) continue;
    skip.add(userId);
    out.push(userId);
  }
  return out;
}

/** Ohne die, die zu dieser Seite schon eine ungelesene Meldung haben. */
export function withoutOpenUpdates(
  candidates: readonly string[],
  open: readonly string[],
): string[] {
  const openSet = new Set(open);
  return candidates.filter((userId) => !openSet.has(userId));
}

/**
 * Benachbarte Textknoten mit gleichen Marken zusammenlegen. Eine Marke
 * ueber einem Teil des Textes teilt den Knoten; ist sie entfernt, muss
 * derselbe Text wieder als ein Knoten dastehen, sonst saehe der
 * Vergleich eine Aenderung, wo keine ist.
 */
function mergeTextNodes(nodes: unknown[]): unknown[] {
  const out: unknown[] = [];
  let lastKey: string | null = null;
  for (const node of nodes) {
    const isText =
      !!node &&
      typeof node === "object" &&
      (node as { type?: unknown }).type === "text" &&
      typeof (node as { text?: unknown }).text === "string";
    if (!isText) {
      out.push(node);
      lastKey = null;
      continue;
    }
    const { text, ...rest } = node as { text: string };
    const key = JSON.stringify(rest);
    if (lastKey === key) {
      const prev = out[out.length - 1] as { text: string };
      out[out.length - 1] = { ...prev, text: prev.text + text };
    } else {
      out.push(node);
      lastKey = key;
    }
  }
  return out;
}

/**
 * ProseMirror-JSON in eine vergleichbare Form bringen: Marken vom Typ
 * commentMark entfernen, ein danach leeres "marks" weglassen, geteilte
 * Textknoten wieder zusammenlegen und die Objektschluessel sortieren.
 */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return mergeTextNodes(node.map(normalize));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    const value = (node as Record<string, unknown>)[key];
    if (key === "marks" && Array.isArray(value)) {
      const kept = value.filter(
        (m) =>
          !(m && typeof m === "object" && (m as { type?: unknown }).type === COMMENT_MARK),
      );
      if (kept.length === 0) continue;
      out[key] = kept.map(normalize);
      continue;
    }
    if (value === undefined) continue;
    out[key] = normalize(value);
  }
  return out;
}

/**
 * Hat sich der Inhalt geaendert? Vergleicht ProseMirror-JSON ohne Marken
 * vom Typ "commentMark" (ein neuer Kommentar-Thread aendert den Inhalt
 * nicht, er meldet sich selbst als COMMENT). Unabhaengig von der
 * Reihenfolge der Objektschluessel (jsonb ordnet sie beim Speichern um);
 * ein nach dem Entfernen leeres "marks" gilt als fehlend. Ohne
 * Vorgaengerversion (prev null/undefined): true.
 */
export function contentChanged(prev: unknown, next: unknown): boolean {
  if (prev === null || prev === undefined) return true;
  return JSON.stringify(normalize(prev)) !== JSON.stringify(normalize(next));
}
