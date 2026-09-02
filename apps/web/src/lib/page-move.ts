import type { FlatPage, TreeNode } from "@/lib/page-tree";

/**
 * Reine Baum-Logik fuer das Verschieben und Sortieren von Seiten.
 * Wird von der Server Action (Positionsberechnung) und vom Seitenbaum
 * (optimistische Anzeige, Drop-Ziel-Pruefung) gemeinsam genutzt.
 */

export type MoveNode = { id: string; parentId: string | null };

export type DropZone = "before" | "after" | "inside";

/** Alle transitiven Nachfahren-IDs einer Seite in einer flachen Liste. */
export function descendantIds(pages: MoveNode[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.parentId) continue;
    const list = byParent.get(p.parentId) ?? [];
    list.push(p.id);
    byParent.set(p.parentId, list);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of byParent.get(current) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

/**
 * Darf `pageId` unter `targetParentId` haengen? Verboten ist die Seite
 * selbst sowie jeder ihrer Nachfahren (sonst entstuende ein Zyklus).
 * `null` = oberste Ebene, immer erlaubt.
 */
export function isValidMoveTarget(
  pages: MoveNode[],
  pageId: string,
  targetParentId: string | null,
): boolean {
  if (targetParentId === null) return true;
  if (targetParentId === pageId) return false;
  return !descendantIds(pages, pageId).has(targetParentId);
}

/**
 * Fuegt `movedId` an Position `index` in die Geschwisterliste ein.
 * Die Seite wird vorher aus der Liste entfernt, `index` bezieht sich
 * also auf die Liste OHNE die verschobene Seite. Ohne `index` (oder bei
 * einem Wert ausserhalb des Bereichs) landet die Seite am Ende bzw. wird
 * auf den gueltigen Bereich begrenzt.
 */
export function insertAt(
  siblings: string[],
  movedId: string,
  index?: number | null,
): string[] {
  const rest = siblings.filter((id) => id !== movedId);
  const at =
    index === undefined || index === null || !Number.isFinite(index)
      ? rest.length
      : Math.min(Math.max(0, Math.trunc(index)), rest.length);
  rest.splice(at, 0, movedId);
  return rest;
}

/**
 * Kompakte Neunummerierung 0..n. Liefert nur die Eintraege, deren
 * Position sich gegenueber `current` tatsaechlich aendert, damit die
 * Server Action moeglichst wenige Updates schreibt.
 */
export function positionUpdates(
  ordered: string[],
  current: ReadonlyMap<string, number>,
): { id: string; position: number }[] {
  const updates: { id: string; position: number }[] = [];
  ordered.forEach((id, position) => {
    if (current.get(id) !== position) updates.push({ id, position });
  });
  return updates;
}

/**
 * Zielindex fuer einen Drop "davor"/"danach" relativ zu `targetId`,
 * bezogen auf die Geschwisterliste ohne die gezogene Seite.
 */
export function dropIndex(
  siblingIds: string[],
  draggedId: string,
  targetId: string,
  zone: Exclude<DropZone, "inside">,
): number {
  const rest = siblingIds.filter((id) => id !== draggedId);
  const at = rest.indexOf(targetId);
  if (at < 0) return rest.length;
  return zone === "after" ? at + 1 : at;
}

/** Aus der relativen Mausposition (0..1) innerhalb einer Zeile die Zone. */
export function zoneFromOffset(ratio: number): DropZone {
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

/** Flache Liste aus einem Baum (Reihenfolge: Tiefensuche). */
export function flattenTree(nodes: TreeNode[]): FlatPage[] {
  const out: FlatPage[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push({
        id: n.id,
        title: n.title,
        parentId: n.parentId,
        position: n.position,
      });
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Wendet ein Verschieben auf eine flache Seitenliste an (fuer die
 * optimistische Anzeige im Baum). Neue und alte Geschwister werden
 * kompakt 0..n nummeriert — dieselbe Semantik wie die Server Action.
 * Ungueltige Ziele (Zyklus, unbekannte Seite) lassen die Liste unveraendert.
 */
export function applyMove(
  pages: FlatPage[],
  pageId: string,
  parentId: string | null,
  index?: number | null,
): FlatPage[] {
  const page = pages.find((p) => p.id === pageId);
  if (!page) return pages;
  if (!isValidMoveTarget(pages, pageId, parentId)) return pages;
  if (parentId !== null && !pages.some((p) => p.id === parentId)) return pages;

  const byPosition = (a: FlatPage, b: FlatPage) =>
    a.position - b.position || a.title.localeCompare(b.title);

  const targetSiblings = pages
    .filter((p) => p.parentId === parentId && p.id !== pageId)
    .sort(byPosition)
    .map((p) => p.id);
  const targetOrder = insertAt(targetSiblings, pageId, index);
  const newPosition = new Map<string, number>();
  targetOrder.forEach((id, i) => newPosition.set(id, i));

  if (page.parentId !== parentId) {
    pages
      .filter((p) => p.parentId === page.parentId && p.id !== pageId)
      .sort(byPosition)
      .forEach((p, i) => newPosition.set(p.id, i));
  }

  return pages.map((p) => {
    const position = newPosition.get(p.id);
    if (p.id === pageId) {
      return { ...p, parentId, position: position ?? p.position };
    }
    return position === undefined || position === p.position
      ? p
      : { ...p, position };
  });
}
