export type FlatPage = {
  id: string;
  title: string;
  icon?: string | null;
  parentId: string | null;
  position: number;
};

export type TreeNode = FlatPage & { children: TreeNode[] };

export function buildTree(pages: FlatPage[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  pages.forEach((p) => byId.set(p.id, { ...p, children: [] }));

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export type Placement = "before" | "after" | "inside";

/** Sortierung wie im Baum: Position, dann Titel. */
function siblingSort(a: FlatPage, b: FlatPage): number {
  return a.position - b.position || a.title.localeCompare(b.title);
}

/** Ist `id` ein Vorfahr von `nodeId` (oder derselbe Knoten)? */
export function isAncestorOrSelf(
  pages: FlatPage[],
  id: string,
  nodeId: string,
): boolean {
  const byId = new Map(pages.map((p) => [p.id, p]));
  let cur: string | null = nodeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === id) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

/**
 * Verschiebt eine Seite vor/nach/in eine Zielseite und liefert die neue
 * flache Liste (Elternbezug + fortlaufende Positionen der neuen
 * Geschwister). null bei ungültigem Zug: unbekannte Seite, auf sich
 * selbst, oder in den eigenen Unterbaum.
 */
export function movePage(
  pages: FlatPage[],
  id: string,
  targetId: string,
  placement: Placement,
): FlatPage[] | null {
  const moved = pages.find((p) => p.id === id);
  const target = pages.find((p) => p.id === targetId);
  if (!moved || !target || id === targetId) return null;
  if (isAncestorOrSelf(pages, id, targetId)) return null;

  const newParent = placement === "inside" ? target.id : target.parentId;
  const siblings = pages
    .filter((p) => p.parentId === newParent && p.id !== id)
    .sort(siblingSort);

  let index = siblings.length;
  if (placement !== "inside") {
    const at = siblings.findIndex((p) => p.id === targetId);
    index = placement === "before" ? at : at + 1;
  }
  siblings.splice(index, 0, { ...moved, parentId: newParent });

  const updated = new Map(
    siblings.map((p, i) => [p.id, { ...p, parentId: newParent, position: i }]),
  );
  return pages.map((p) => updated.get(p.id) ?? p);
}

/** Zeilen, deren parentId oder position sich geändert hat. */
export function changedPages(before: FlatPage[], after: FlatPage[]): FlatPage[] {
  const prev = new Map(before.map((p) => [p.id, p]));
  return after.filter((p) => {
    const b = prev.get(p.id);
    return !b || b.parentId !== p.parentId || b.position !== p.position;
  });
}
