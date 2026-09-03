/**
 * Eigener, abhängigkeitsfreier Text-Diff für den Versionsvergleich.
 *
 * Zwei Ebenen:
 *  1. Zeilen-Diff (Myers O(ND)) liefert Blöcke aus gleichen, gelöschten
 *     und eingefügten Zeilen.
 *  2. Steht eine gelöschte Zeile einer eingefügten gegenüber, wird das
 *     Paar als "changed" mit Wort-Diff dargestellt, sofern sich die Zeilen
 *     noch ähnlich genug sind — sonst bleibt es bei entfernt/hinzugefügt.
 */

export type DiffToken = {
  kind: "equal" | "added" | "removed";
  text: string;
};

export type ChangedLine = {
  removed: DiffToken[];
  added: DiffToken[];
};

export type DiffBlock =
  | { kind: "equal"; lines: string[] }
  | { kind: "added"; lines: string[] }
  | { kind: "removed"; lines: string[] }
  | { kind: "changed"; lines: ChangedLine[] };

export type TextDiff = {
  blocks: DiffBlock[];
  /** Hinzugefügte Zeilen (geänderte zählen auf beiden Seiten). */
  added: number;
  /** Entfernte Zeilen. */
  removed: number;
};

type EditOp = { op: "eq" | "del" | "ins"; a?: number; b?: number };

/**
 * Obergrenze für die Zellen des Pfadverlaufs (Schritte × Diagonalen).
 * Entspricht rund 16 MB Int32 und einigen hundert Millisekunden — mehr
 * darf ein einzelner Seitenaufruf nicht kosten.
 */
const TRACE_BUDGET = 4_000_000;

/**
 * Myers-Diff auf beliebigen Sequenzen. Gibt die Edit-Operationen in
 * Reihenfolge zurück (gleich, löschen aus a, einfügen aus b).
 */
function diffSequence<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean,
): EditOp[] {
  // Gemeinsames Präfix/Suffix abschneiden: verkleinert das Problem stark.
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start], b[start])) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }

  const ops: EditOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ op: "eq", a: i, b: i });
  ops.push(...myers(a.slice(start, endA), b.slice(start, endB), eq, start));
  for (let i = 0; i < a.length - endA; i++) {
    ops.push({ op: "eq", a: endA + i, b: endB + i });
  }
  return ops;
}

function myers<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean,
  offset: number,
): EditOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return b.map((_, j) => ({ op: "ins" as const, b: offset + j }));
  }
  if (m === 0) {
    return a.map((_, i) => ({ op: "del" as const, a: offset + i }));
  }

  const max = n + m;
  const size = 2 * max + 1;
  // v[k + max] = weitester x-Wert auf Diagonale k
  let v = new Int32Array(size).fill(-1);
  v[max + 1] = 0;
  const trace: Int32Array[] = [];
  // Speicher- und Zeitbudget: der Pfadverlauf braucht pro Schritt eine
  // Kopie von v. Sind zwei Sequenzen fast vollständig verschieden, wächst
  // das quadratisch — dann ist "alles entfernt, alles hinzugefügt" die
  // ehrlichere und vor allem sofortige Antwort.
  const maxD = Math.min(max, Math.floor(TRACE_BUDGET / size));
  let solved = false;

  outer: for (let d = 0; d <= maxD; d++) {
    trace.push(v);
    const next = new Int32Array(v);
    for (let k = -d; k <= d; k += 2) {
      const idx = k + max;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
        x = v[idx + 1]; // nach unten (Einfügen)
      } else {
        x = v[idx - 1] + 1; // nach rechts (Löschen)
      }
      let y = x - k;
      while (x < n && y < m && eq(a[x], b[y])) {
        x++;
        y++;
      }
      next[idx] = x;
      if (x >= n && y >= m) {
        solved = true;
        break outer;
      }
    }
    v = next;
  }
  if (!solved) {
    return [
      ...a.map((_, i) => ({ op: "del" as const, a: offset + i })),
      ...b.map((_, j) => ({ op: "ins" as const, b: offset + j })),
    ];
  }

  // Rückwärts den Pfad rekonstruieren: trace[d] ist der Zustand VOR
  // Schritt d, also genau der, mit dem der Schritt vorwärts entschieden
  // wurde.
  const ops: EditOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const idx = k + max;
    let prevK: number;
    if (k === -d || (k !== d && prev[idx - 1] < prev[idx + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prev[prevK + max];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ op: "eq", a: offset + x, b: offset + y });
    }
    if (d > 0) {
      if (x === prevX) {
        y--;
        ops.push({ op: "ins", b: offset + y });
      } else {
        x--;
        ops.push({ op: "del", a: offset + x });
      }
    }
  }
  return ops.reverse();
}

/** Wort-Tokens inkl. Leerraum-Tokens, damit sich der Text verlustfrei zusammensetzt. */
function tokenizeWords(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t.length > 0);
}

function mergeTokens(tokens: DiffToken[]): DiffToken[] {
  const out: DiffToken[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (last && last.kind === t.kind) last.text += t.text;
    else out.push({ ...t });
  }
  return out;
}

/**
 * Wort-Diff zweier Zeilen: Tokens für die "alte" Seite (equal/removed)
 * und die "neue" Seite (equal/added).
 */
export function diffWords(
  oldLine: string,
  newLine: string,
): { removed: DiffToken[]; added: DiffToken[] } {
  const a = tokenizeWords(oldLine);
  const b = tokenizeWords(newLine);
  const ops = diffSequence(a, b, (x, y) => x === y);
  const removed: DiffToken[] = [];
  const added: DiffToken[] = [];
  for (const op of ops) {
    if (op.op === "eq") {
      removed.push({ kind: "equal", text: a[op.a!] });
      added.push({ kind: "equal", text: b[op.b!] });
    } else if (op.op === "del") {
      removed.push({ kind: "removed", text: a[op.a!] });
    } else {
      added.push({ kind: "added", text: b[op.b!] });
    }
  }
  return { removed: mergeTokens(removed), added: mergeTokens(added) };
}

/** Anteil gemeinsamer Zeichen (0..1) — entscheidet über "changed" vs. Paar. */
function similarity(pair: ChangedLine): number {
  const total = pair.removed.reduce((s, t) => s + t.text.length, 0) +
    pair.added.reduce((s, t) => s + t.text.length, 0);
  if (total === 0) return 1;
  const equal = pair.removed
    .filter((t) => t.kind === "equal")
    .reduce((s, t) => s + t.text.trim().length, 0);
  return (2 * equal) / total;
}

/** Ab diesem Ähnlichkeitswert wird ein Zeilenpaar als Änderung gezeigt. */
const CHANGED_THRESHOLD = 0.3;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // Abschliessender Zeilenumbruch erzeugt keine leere Extra-Zeile.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Zeilen-Diff zweier Texte als Blöcke. Gegenüberstehende Lösch-/
 * Einfüge-Läufe werden paarweise zu "changed"-Zeilen mit Wort-Diff.
 */
export function diffText(oldText: string, newText: string): TextDiff {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffSequence(a, b, (x, y) => x === y);

  const blocks: DiffBlock[] = [];
  let added = 0;
  let removed = 0;

  const push = (block: DiffBlock) => {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === block.kind) {
      (last.lines as unknown[]).push(...(block.lines as unknown[]));
    } else {
      blocks.push(block);
    }
  };

  const flushRun = (dels: string[], ins: string[]) => {
    const pairs = Math.min(dels.length, ins.length);
    let i = 0;
    for (; i < pairs; i++) {
      const pair = diffWords(dels[i], ins[i]);
      if (similarity(pair) >= CHANGED_THRESHOLD) {
        push({ kind: "changed", lines: [pair] });
      } else {
        push({ kind: "removed", lines: [dels[i]] });
        push({ kind: "added", lines: [ins[i]] });
      }
      removed++;
      added++;
    }
    if (dels.length > pairs) {
      const rest = dels.slice(pairs);
      push({ kind: "removed", lines: rest });
      removed += rest.length;
    }
    if (ins.length > pairs) {
      const rest = ins.slice(pairs);
      push({ kind: "added", lines: rest });
      added += rest.length;
    }
  };

  let dels: string[] = [];
  let ins: string[] = [];
  for (const op of ops) {
    if (op.op === "eq") {
      if (dels.length || ins.length) {
        flushRun(dels, ins);
        dels = [];
        ins = [];
      }
      push({ kind: "equal", lines: [a[op.a!]] });
    } else if (op.op === "del") {
      dels.push(a[op.a!]);
    } else {
      ins.push(b[op.b!]);
    }
  }
  if (dels.length || ins.length) flushRun(dels, ins);

  return { blocks, added, removed };
}
