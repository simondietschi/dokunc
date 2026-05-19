export type FlatPage = {
  id: string;
  title: string;
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
