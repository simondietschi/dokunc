/**
 * Textvergleich für den Versionsverlauf: Zeilen-Diff (Myers) mit
 * Wort-Verfeinerung innerhalb geänderter Zeilenpaare. Ohne Abhängigkeit.
 */

export type OpType = "equal" | "insert" | "delete";
export type DiffOp<T> = { type: OpType; value: T };

/** Ab dieser Gesamtlänge wird nicht mehr fein verglichen (Speicher). */
const MAX_EDIT_SPACE = 4000;

/**
 * Myers-Diff (O((N+M)·D)) mit Rückverfolgung. Liefert die kürzeste
 * Bearbeitungsfolge; bei zu grossen Eingaben grober Fallback
 * (alles gelöscht + alles eingefügt).
 */
export function diffSequences<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean = (x, y) => x === y,
): DiffOp<T>[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  if (max > MAX_EDIT_SPACE) {
    return [
      ...a.map((value) => ({ type: "delete" as const, value })),
      ...b.map((value) => ({ type: "insert" as const, value })),
    ];
  }

  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) {
        x = v[off + k + 1];
      } else {
        x = v[off + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && eq(a[x], b[y])) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  const ops: DiffOp<T>[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vd[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", value: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: "insert", value: b[y - 1] });
        y--;
      } else {
        ops.push({ type: "delete", value: a[x - 1] });
        x--;
      }
    }
  }
  return ops.reverse();
}

export type Segment = { type: OpType; text: string };
export type DiffLine = { type: OpType; segments: Segment[] };

/** Wörter und Leerraum als getrennte Token (Leerraum bleibt erhalten). */
function tokens(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

/** Benachbarte Segmente gleichen Typs zusammenfassen. */
function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.type === s.type) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/** Wortweiser Vergleich zweier Zeilen -> je eine Segmentliste. */
function refine(before: string, after: string): [Segment[], Segment[]] {
  const ops = diffSequences(tokens(before), tokens(after));
  const del: Segment[] = [];
  const ins: Segment[] = [];
  for (const op of ops) {
    if (op.type === "equal") {
      del.push({ type: "equal", text: op.value });
      ins.push({ type: "equal", text: op.value });
    } else if (op.type === "delete") {
      del.push({ type: "delete", text: op.value });
    } else {
      ins.push({ type: "insert", text: op.value });
    }
  }
  return [merge(del), merge(ins)];
}

/**
 * Zeilenvergleich zweier Texte. Zusammenhängende Blöcke aus gelöschten
 * und eingefügten Zeilen werden paarweise wortgenau verfeinert.
 */
export function diffText(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  const ops = diffSequences(a, b);
  const lines: DiffLine[] = [];

  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      lines.push({
        type: "equal",
        segments: [{ type: "equal", text: ops[i].value }],
      });
      i++;
      continue;
    }
    const deleted: string[] = [];
    const inserted: string[] = [];
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") deleted.push(ops[i].value);
      else inserted.push(ops[i].value);
      i++;
    }
    const pairs = Math.min(deleted.length, inserted.length);
    const delLines: DiffLine[] = [];
    const insLines: DiffLine[] = [];
    for (let p = 0; p < pairs; p++) {
      const [d, n] = refine(deleted[p], inserted[p]);
      delLines.push({ type: "delete", segments: d });
      insLines.push({ type: "insert", segments: n });
    }
    for (let p = pairs; p < deleted.length; p++) {
      delLines.push({
        type: "delete",
        segments: [{ type: "delete", text: deleted[p] }],
      });
    }
    for (let p = pairs; p < inserted.length; p++) {
      insLines.push({
        type: "insert",
        segments: [{ type: "insert", text: inserted[p] }],
      });
    }
    lines.push(...delLines, ...insLines);
  }
  return lines;
}

/** Zusammenfassung: Anzahl eingefügter und gelöschter Zeilen. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "insert") added++;
    else if (l.type === "delete") removed++;
  }
  return { added, removed };
}
