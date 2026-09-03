/**
 * Minimaler HTML-Tag-Tokenizer und -Rewriter fuer Export-HTML
 * (Confluence, Notion). Es gibt bewusst keinen DOM: Das Ergebnis geht
 * ohnehin durch den ProseMirror-Parser des Editor-Schemas, der alles
 * Unbekannte verwirft. Hier werden nur Tags umbenannt, Attribute gesetzt
 * und Teilbaeume entfernt — passend verschachtelt ueber einen Stack.
 */

export type Token =
  | { kind: "open"; name: string; attrs: Map<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/** Elemente, deren Inhalt komplett verworfen wird. */
const DROP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "object",
  "embed",
  "nav",
]);

const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of raw.matchAll(ATTR_RE)) {
    attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * Zerlegt HTML in Tags und Text. Kommentare, Doctype und CDATA werden
 * verworfen; der Inhalt von script/style etc. ebenfalls.
 */
export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g;
  let dropUntil: string | null = null;
  for (const m of html.matchAll(re)) {
    const raw = m[0];
    if (m[1] !== undefined) {
      const name = m[1].toLowerCase();
      if (dropUntil) {
        if (name === dropUntil) dropUntil = null;
        continue;
      }
      tokens.push({ kind: "close", name });
      continue;
    }
    if (m[2] !== undefined) {
      const name = m[2].toLowerCase();
      if (dropUntil) continue;
      const attrRaw = m[3] ?? "";
      const selfClosing = /\/\s*$/.test(attrRaw) || VOID.has(name);
      if (DROP.has(name)) {
        if (!VOID.has(name) && !/\/\s*$/.test(attrRaw)) dropUntil = name;
        continue;
      }
      tokens.push({
        kind: "open",
        name,
        attrs: parseAttrs(attrRaw.replace(/\/\s*$/, "")),
        selfClosing,
      });
      continue;
    }
    if (raw.startsWith("<!")) continue;
    if (dropUntil) continue;
    tokens.push({ kind: "text", text: raw });
  }
  return tokens;
}

function escapeAttr(v: string): string {
  return v.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;");
}

export function serialize(tokens: Token[]): string {
  let out = "";
  for (const t of tokens) {
    if (t.kind === "text") {
      // Nacktes ">" (z. B. "A-->B" in Code) kann den HTML-Parser des
      // Schemas verwirren; als Entity ist es eindeutig.
      out += t.text.replace(/>/g, "&gt;");
    } else if (t.kind === "close") {
      out += `</${t.name}>`;
    } else {
      let attrs = "";
      for (const [k, v] of t.attrs) attrs += ` ${k}="${escapeAttr(v)}"`;
      out += `<${t.name}${attrs}>`;
    }
  }
  return out;
}

export function classes(t: Token): Set<string> {
  if (t.kind !== "open") return new Set();
  return new Set((t.attrs.get("class") ?? "").split(/\s+/).filter(Boolean));
}

export function hasClass(t: Token, cls: string): boolean {
  return classes(t).has(cls);
}

/** Text zwischen den Tokens (Entities bleiben kodiert). */
export function innerText(tokens: Token[]): string {
  return tokens
    .filter((t): t is Extract<Token, { kind: "text" }> => t.kind === "text")
    .map((t) => t.text)
    .join("");
}

/**
 * Sucht das erste oeffnende Tag, das `match` erfuellt, und liefert die
 * Tokens zwischen ihm und seinem schliessenden Tag (Stack pro Tagname).
 */
export function findRegion(
  tokens: Token[],
  match: (t: Extract<Token, { kind: "open" }>) => boolean,
): Token[] | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "open" || t.selfClosing || !match(t)) continue;
    let depth = 0;
    for (let j = i + 1; j < tokens.length; j++) {
      const u = tokens[j];
      if (u.kind === "open" && u.name === t.name && !u.selfClosing) depth++;
      else if (u.kind === "close" && u.name === t.name) {
        if (depth === 0) return tokens.slice(i + 1, j);
        depth--;
      }
    }
    return tokens.slice(i + 1);
  }
  return null;
}

/** Alle Regionen, deren oeffnendes Tag `match` erfuellt (nicht rekursiv). */
export function findRegions(
  tokens: Token[],
  match: (t: Extract<Token, { kind: "open" }>) => boolean,
): { open: Extract<Token, { kind: "open" }>; inner: Token[] }[] {
  const out: { open: Extract<Token, { kind: "open" }>; inner: Token[] }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "open" && !t.selfClosing && match(t)) {
      const inner = findRegion(tokens.slice(i), match) ?? [];
      out.push({ open: t, inner });
      i += inner.length + 2;
      continue;
    }
    i++;
  }
  return out;
}

/** Entscheidung einer Rewrite-Regel fuer ein oeffnendes Tag. */
export type Decision =
  | { action: "keep" }
  | { action: "drop" }
  | {
      action: "rewrite";
      name?: string;
      attrs?: Record<string, string | null>;
      /** Zusatz-Tokens direkt nach dem oeffnenden Tag (z. B. <code>). */
      prefix?: Token[];
      /** Zusatz-Tokens direkt vor dem schliessenden Tag. */
      suffix?: Token[];
    };

export type OpenToken = Extract<Token, { kind: "open" }>;

/** Kontext, den eine Regel sieht: Vorfahren und die Folge-Tokens. */
export type RuleContext = {
  ancestors: OpenToken[];
  /** Tokens des Elementinhalts (bis zum passenden schliessenden Tag). */
  inner: () => Token[];
};

export type Rule = (tag: OpenToken, ctx: RuleContext) => Decision | null;

type Frame = {
  name: string;
  original: OpenToken;
  dropped: boolean;
  suffix: Token[];
};

/**
 * Wendet Regeln auf jedes oeffnende Tag an und haelt schliessende Tags
 * konsistent (umbenannt, entfernt, ergaenzt). Unbalanciertes HTML wird
 * tolerant behandelt: ein schliessendes Tag ohne passenden Frame wird
 * verworfen; offene Frames am Ende werden geschlossen.
 */
export function rewrite(tokens: Token[], rules: Rule[]): Token[] {
  const out: Token[] = [];
  const stack: Frame[] = [];
  const dropDepth = () => stack.some((f) => f.dropped);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "text") {
      if (!dropDepth()) out.push(t);
      continue;
    }
    if (t.kind === "close") {
      // Passenden Frame suchen (von oben); dazwischenliegende schliessen.
      let idx = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].original.name === t.name) {
          idx = s;
          break;
        }
      }
      if (idx < 0) continue;
      while (stack.length > idx) {
        const frame = stack.pop()!;
        if (frame.dropped || dropDepth()) continue;
        out.push(...frame.suffix, { kind: "close", name: frame.name });
      }
      continue;
    }

    if (dropDepth()) {
      if (!t.selfClosing) {
        stack.push({ name: t.name, original: t, dropped: true, suffix: [] });
      }
      continue;
    }

    const ctx: RuleContext = {
      ancestors: stack.map((f) => f.original),
      inner: () => findRegion(tokens.slice(i), (o) => o === t) ?? [],
    };
    let decision: Decision = { action: "keep" };
    for (const rule of rules) {
      const d = rule(t, ctx);
      if (d) {
        decision = d;
        break;
      }
    }

    if (decision.action === "drop") {
      if (!t.selfClosing) {
        stack.push({ name: t.name, original: t, dropped: true, suffix: [] });
      }
      continue;
    }

    let name = t.name;
    const attrs = new Map(t.attrs);
    let prefix: Token[] = [];
    let suffix: Token[] = [];
    if (decision.action === "rewrite") {
      if (decision.name) name = decision.name;
      for (const [k, v] of Object.entries(decision.attrs ?? {})) {
        if (v === null) attrs.delete(k);
        else attrs.set(k, v);
      }
      prefix = decision.prefix ?? [];
      suffix = decision.suffix ?? [];
    }
    out.push({ kind: "open", name, attrs, selfClosing: t.selfClosing });
    if (t.selfClosing) continue;
    out.push(...prefix);
    stack.push({ name, original: t, dropped: false, suffix });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.dropped || stack.some((f) => f.dropped)) continue;
    out.push(...frame.suffix, { kind: "close", name: frame.name });
  }
  return out;
}

export function open(name: string, attrs: Record<string, string> = {}): OpenToken {
  return {
    kind: "open",
    name,
    attrs: new Map(Object.entries(attrs)),
    selfClosing: VOID.has(name),
  };
}

export function close(name: string): Token {
  return { kind: "close", name };
}
