/**
 * Reine Logik für das Kopieren von Seiten (Duplizieren, Vorlagen).
 * Ohne DB-Zugriff, damit sie testbar bleibt.
 */

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: unknown[];
};

/**
 * Entfernt alle Kommentar-Markierungen (commentMark) aus ProseMirror-JSON.
 * Kommentar-Threads gehören zur Originalseite — eine Kopie darf keine
 * Anker auf fremde Threads tragen. Liefert ein neues Objekt (immutabel).
 */
export function stripCommentMarks<T>(content: T): T {
  if (!content || typeof content !== "object") return content;
  if (Array.isArray(content)) {
    return content.map((c) => stripCommentMarks(c)) as unknown as T;
  }
  const node = content as JsonNode;
  const out: JsonNode = { ...node };
  if (Array.isArray(node.marks)) {
    const marks = node.marks.filter((m) => m?.type !== "commentMark");
    if (marks.length > 0) out.marks = marks;
    else delete out.marks;
  }
  if (Array.isArray(node.content)) {
    out.content = node.content.map((c) => stripCommentMarks(c));
  }
  return out as T;
}

/** Titel einer Kopie: "Titel (Kopie)". */
export function copyTitle(title: string): string {
  const base = title.trim() || "Untitled";
  return `${base} (Kopie)`;
}

export type CopySource = {
  id: string;
  parentId: string | null;
  title: string;
  position: number;
};

export type CopyStep = {
  /** ID der Quellseite. */
  sourceId: string;
  /** Quell-ID der Elternseite innerhalb des kopierten Baums (null = Wurzel). */
  parentSourceId: string | null;
  title: string;
  position: number;
};

/**
 * Plant eine tiefe Kopie eines Unterbaums: liefert die anzulegenden
 * Seiten in Eltern-vor-Kind-Reihenfolge, Geschwister nach position
 * (dann Titel) sortiert — die Reihenfolge des Originals bleibt erhalten.
 * Die Wurzel bekommt den Kopie-Titel und die gewünschte Position,
 * Unterseiten behalten Titel und Position.
 */
export function planSubtreeCopy(
  pages: CopySource[],
  rootId: string,
  opts: { withChildren: boolean; rootPosition: number },
): CopyStep[] {
  const root = pages.find((p) => p.id === rootId);
  if (!root) return [];

  const steps: CopyStep[] = [
    {
      sourceId: root.id,
      parentSourceId: null,
      title: copyTitle(root.title),
      position: opts.rootPosition,
    },
  ];
  if (!opts.withChildren) return steps;

  const byParent = new Map<string, CopySource[]>();
  for (const p of pages) {
    if (!p.parentId) continue;
    const list = byParent.get(p.parentId) ?? [];
    list.push(p);
    byParent.set(p.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort(
      (a, b) => a.position - b.position || a.title.localeCompare(b.title),
    );
  }

  // Breitensuche mit Zyklusschutz (Baum aus der DB sollte keinen haben,
  // eine manipulierte Struktur darf aber nicht zur Endlosschleife führen).
  const seen = new Set<string>([root.id]);
  const queue: string[] = [root.id];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const child of byParent.get(parentId) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      steps.push({
        sourceId: child.id,
        parentSourceId: parentId,
        title: child.title,
        position: child.position,
      });
      queue.push(child.id);
    }
  }
  return steps;
}
