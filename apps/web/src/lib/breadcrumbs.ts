/**
 * Kuerzt lange Brotkrumen-Pfade: der erste und die letzten Eintraege
 * bleiben sichtbar, der Mittelteil wird zu einem "..."-Eintrag
 * zusammengefasst, der die ausgeblendeten Eintraege mitfuehrt (fuer
 * Tooltip bzw. Aufklappen).
 */
export type CrumbSlot<T> =
  | { kind: "item"; item: T }
  | { kind: "ellipsis"; hidden: T[] };

export function collapseCrumbs<T>(items: T[], max = 4): CrumbSlot<T>[] {
  const limit = Math.max(3, max);
  if (items.length <= limit) {
    return items.map((item) => ({ kind: "item", item }));
  }
  const tailCount = limit - 2;
  const head = items[0];
  const tail = items.slice(items.length - tailCount);
  const hidden = items.slice(1, items.length - tailCount);
  return [
    { kind: "item", item: head },
    { kind: "ellipsis", hidden },
    ...tail.map((item): CrumbSlot<T> => ({ kind: "item", item })),
  ];
}
