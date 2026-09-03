import { generateJSON } from "@tiptap/html";
import { richExtensions } from "@dokunc/editor";
import {
  tokenize,
  serialize,
  rewrite,
  findRegion,
  innerText,
  hasClass,
  classes,
  open,
  close,
  type Decision,
  type OpenToken,
  type Rule,
  type Token,
} from "./html-tags";
import { normalizeDoc, stripLeadingTitle } from "./doc";
import { collapseWhitespace, decodeEntities } from "./text";
import { DATA_IMAGE_PREFIX, type ImportFormat, type JsonNode } from "./types";

/**
 * HTML (Confluence-/Notion-Export oder generisch) -> ProseMirror-JSON.
 * Ablauf: Tokenisieren -> Inhaltsbereich waehlen -> Export-Eigenheiten
 * per Regeln auf das Editor-Schema abbilden (Callouts, Aufgabenlisten,
 * Codebloecke, Toggles) -> generateJSON() -> Nachbearbeitung (doc.ts).
 * Es wird nie Roh-HTML gespeichert: alles laeuft durch das Schema.
 */

const extensions = richExtensions();

/* ------------------------------------------------------------------ */
/* Regeln                                                              */
/* ------------------------------------------------------------------ */

function isWhitespace(t: Token): boolean {
  return t.kind === "text" && t.text.trim() === "";
}

/** Erstes bedeutsames Token des Elementinhalts (nach Leerraum/<p>). */
function firstMeaningful(inner: Token[]): Token | null {
  for (const t of inner) {
    if (isWhitespace(t)) continue;
    if (t.kind === "open" && t.name === "p") continue;
    return t;
  }
  return null;
}

function isCheckboxInput(t: Token | null): t is OpenToken {
  return (
    !!t &&
    t.kind === "open" &&
    t.name === "input" &&
    (t.attrs.get("type") ?? "").toLowerCase() === "checkbox"
  );
}

function isNotionCheckbox(t: Token | null): t is OpenToken {
  return !!t && t.kind === "open" && t.name === "div" && hasClass(t, "checkbox");
}

/** Direkte <li>-Kinder einer Liste. */
function directItems(inner: Token[]): { tag: OpenToken; inner: Token[] }[] {
  const items: { tag: OpenToken; inner: Token[] }[] = [];
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const t = inner[i];
    if (t.kind === "open" && !t.selfClosing) {
      if (depth === 0 && t.name === "li") {
        const body = findRegion(inner.slice(i), (o) => o === t) ?? [];
        items.push({ tag: t, inner: body });
        i += body.length + 1;
        continue;
      }
      depth++;
    } else if (t.kind === "close") {
      depth = Math.max(0, depth - 1);
    }
  }
  return items;
}

function itemIsTask(li: OpenToken, inner: Token[]): boolean {
  const first = firstMeaningful(inner);
  return hasClass(li, "checked") || isCheckboxInput(first) || isNotionCheckbox(first);
}

function itemIsChecked(li: OpenToken, inner: Token[]): boolean {
  if (hasClass(li, "checked")) return true;
  const first = firstMeaningful(inner);
  if (isCheckboxInput(first)) return first.attrs.has("checked");
  if (isNotionCheckbox(first)) return hasClass(first, "checkbox-on");
  return false;
}

/**
 * Erzeugt den Regelsatz. Der Zustand (welche Listen Aufgabenlisten sind)
 * lebt pro Aufruf, weil <li>-Regeln die Entscheidung ihrer Elternliste
 * brauchen (Vorfahren sind die Original-Tokens).
 */
function buildRules(format: ImportFormat): { rules: Rule[]; dataUrls: string[] } {
  const dataUrls: string[] = [];
  const taskLists = new WeakSet<OpenToken>();
  const toggles = new WeakSet<OpenToken>();
  const callouts = new WeakSet<OpenToken>();

  const parentOf = (ctx: { ancestors: OpenToken[] }) =>
    ctx.ancestors[ctx.ancestors.length - 1] ?? null;
  const inside = (ctx: { ancestors: OpenToken[] }, set: WeakSet<OpenToken>) =>
    ctx.ancestors.some((a) => set.has(a));

  const rules: Rule[] = [
    // --- Kopfdaten: <title> ist bereits ausgelesen, Rest ist kein Inhalt ---
    (tag) =>
      tag.name === "title" || tag.name === "meta" || tag.name === "link" || tag.name === "base"
        ? { action: "drop" }
        : null,

    // --- data:-Bilder durch Platzhalter ersetzen (siehe DATA_IMAGE_PREFIX) ---
    (tag) => {
      if (tag.name !== "img") return null;
      const src = tag.attrs.get("src") ?? "";
      if (!/^data:/i.test(src)) return null;
      dataUrls.push(src);
      return {
        action: "rewrite",
        attrs: { src: `${DATA_IMAGE_PREFIX}${dataUrls.length - 1}` },
      };
    },

    // --- Listen: Aufgabenlisten (GFM-HTML, Confluence, Notion) ---
    (tag, ctx): Decision | null => {
      if (tag.name !== "ul" && tag.name !== "ol") return null;
      if (hasClass(tag, "toggle")) {
        toggles.add(tag);
        return { action: "rewrite", name: "div", attrs: { class: null } };
      }
      const explicit =
        hasClass(tag, "inline-task-list") ||
        hasClass(tag, "to-do-list") ||
        tag.attrs.get("data-type") === "taskList";
      const items = explicit ? [] : directItems(ctx.inner());
      const implicit =
        items.length > 0 && items.every((it) => itemIsTask(it.tag, it.inner));
      if (!explicit && !implicit) return null;
      taskLists.add(tag);
      return {
        action: "rewrite",
        name: "ul",
        attrs: { "data-type": "taskList", class: null, id: null },
      };
    },
    (tag, ctx): Decision | null => {
      if (tag.name !== "li") return null;
      const parent = parentOf(ctx);
      if (parent && toggles.has(parent)) {
        return { action: "rewrite", name: "div", attrs: { class: null } };
      }
      if (!parent || !taskLists.has(parent)) return null;
      const checked =
        tag.attrs.get("data-checked") === "true" ||
        itemIsChecked(tag, ctx.inner());
      return {
        action: "rewrite",
        attrs: {
          "data-type": "taskItem",
          "data-checked": checked ? "true" : "false",
          class: null,
          id: null,
        },
      };
    },
    // Checkbox-Elemente selbst verschwinden (Status steht im Attribut).
    (tag) => (isCheckboxInput(tag) || isNotionCheckbox(tag) ? { action: "drop" } : null),

    // --- Toggles (Notion): details/summary zu Absaetzen ---
    (tag) => (tag.name === "details" ? { action: "rewrite", name: "div", attrs: { open: null } } : null),
    (tag) =>
      tag.name === "summary"
        ? {
            action: "rewrite",
            name: "p",
            prefix: [open("strong")],
            suffix: [close("strong")],
          }
        : null,

    // --- Callouts ---
    (tag) => {
      if (tag.name !== "div" || !hasClass(tag, "confluence-information-macro")) {
        return null;
      }
      const cls = classes(tag);
      const type = cls.has("confluence-information-macro-warning")
        ? "danger"
        : cls.has("confluence-information-macro-note")
          ? "warn"
          : cls.has("confluence-information-macro-tip")
            ? "success"
            : "info";
      callouts.add(tag);
      return { action: "rewrite", attrs: { "data-callout": type, class: null } };
    },
    // Notion: figure.callout (HTML-Export) bzw. <aside> (Markdown-Export).
    (tag) => {
      const isCallout =
        (tag.name === "figure" && hasClass(tag, "callout")) || tag.name === "aside";
      if (!isCallout) return null;
      callouts.add(tag);
      return {
        action: "rewrite",
        name: "div",
        attrs: { "data-callout": "info", class: null, style: null },
      };
    },
    // Makro-Titel fett hervorheben, Icons verwerfen.
    (tag, ctx) => {
      if (!inside(ctx, callouts)) return null;
      if (tag.name === "span" && (hasClass(tag, "aui-icon") || hasClass(tag, "icon"))) {
        return { action: "drop" };
      }
      if (tag.name === "p" && hasClass(tag, "title")) {
        return {
          action: "rewrite",
          attrs: { class: null },
          prefix: [open("strong")],
          suffix: [close("strong")],
        };
      }
      return null;
    },

    // --- Codebloecke (Confluence: Sprache aus brush-Parameter) ---
    (tag, ctx) => {
      if (tag.name !== "pre") return null;
      const first = firstMeaningful(ctx.inner());
      if (first && first.kind === "open" && first.name === "code") return null;
      const params = tag.attrs.get("data-syntaxhighlighter-params") ?? "";
      const brush = /brush:\s*([\w+#-]+)/i.exec(params)?.[1];
      const lang = brush ? brush.toLowerCase() : null;
      return {
        action: "rewrite",
        attrs: { class: null, "data-syntaxhighlighter-params": null, "data-theme": null },
        prefix: [open("code", lang ? { class: `language-${lang}` } : {})],
        suffix: [close("code")],
      };
    },

    // --- Confluence: Deko und Navigations-Reste verwerfen ---
    (tag) => {
      if (tag.name === "img") {
        const src = tag.attrs.get("src") ?? "";
        if (hasClass(tag, "emoticon") || /(^|\/)images\/icons\//.test(src)) {
          return { action: "drop" };
        }
        return null;
      }
      if (tag.name === "div") {
        const cls = classes(tag);
        if (
          cls.has("toc-macro") ||
          cls.has("pageSection") ||
          cls.has("plugin_attachments_container") ||
          cls.has("expand-control-icon") ||
          tag.attrs.get("id") === "breadcrumb-section" ||
          tag.attrs.get("id") === "footer"
        ) {
          return { action: "drop" };
        }
        if (cls.has("expand-control")) {
          return {
            action: "rewrite",
            name: "p",
            attrs: { class: null },
            prefix: [open("strong")],
            suffix: [close("strong")],
          };
        }
      }
      if (tag.name === "span" && (hasClass(tag, "expand-control-icon") || hasClass(tag, "aui-icon"))) {
        return { action: "drop" };
      }
      return null;
    },

    // --- Notion: KaTeX-Duplikate (nur die TeX-Quelle behalten) ---
    (tag) => {
      if (tag.name === "span" && hasClass(tag, "katex-html")) return { action: "drop" };
      if (tag.name === "mrow") return { action: "drop" };
      return null;
    },
  ];

  if (format === "confluence") {
    rules.push((tag) =>
      tag.name === "h1" && tag.attrs.get("id") === "title-heading"
        ? { action: "drop" }
        : null,
    );
  }
  return { rules, dataUrls };
}

/* ------------------------------------------------------------------ */
/* Titel und Inhaltsbereich                                            */
/* ------------------------------------------------------------------ */

function textOf(tokens: Token[] | null): string | null {
  if (!tokens) return null;
  const text = collapseWhitespace(decodeEntities(innerText(tokens)));
  return text || null;
}

function region(tokens: Token[], name: string, pred?: (t: OpenToken) => boolean) {
  return findRegion(tokens, (t) => t.name === name && (!pred || pred(t)));
}

/**
 * Confluence: "Space : Seite" bzw. "Seite - Confluence" bereinigen. Der
 * Suffix nach " - " kommt nur im <title> vor; #title-text traegt den
 * exakten Seitentitel (der selbst " - " enthalten darf).
 */
export function cleanConfluenceTitle(raw: string, stripSuffix = true): string {
  let t = raw.trim();
  if (stripSuffix) t = t.replace(/\s+-\s+[^-]*$/, "");
  t = t.replace(/^[^:]*\s:\s+/, "");
  return t.trim();
}

function extractTitle(tokens: Token[], format: ImportFormat): string | null {
  if (format === "confluence") {
    const span = textOf(region(tokens, "span", (t) => t.attrs.get("id") === "title-text"));
    if (span) return cleanConfluenceTitle(span, false);
    const title = textOf(region(tokens, "title"));
    return title ? cleanConfluenceTitle(title) : null;
  }
  if (format === "notion") {
    const h1 = textOf(region(tokens, "h1", (t) => hasClass(t, "page-title")));
    if (h1) return h1;
    return textOf(region(tokens, "title"));
  }
  return textOf(region(tokens, "title")) ?? textOf(region(tokens, "h1"));
}

function extractContent(tokens: Token[], format: ImportFormat): Token[] {
  if (format === "confluence") {
    return (
      region(tokens, "div", (t) => t.attrs.get("id") === "main-content") ??
      region(tokens, "body") ??
      tokens
    );
  }
  if (format === "notion") {
    return (
      region(tokens, "div", (t) => hasClass(t, "page-body")) ??
      region(tokens, "article") ??
      region(tokens, "body") ??
      tokens
    );
  }
  return region(tokens, "body") ?? tokens;
}

/* ------------------------------------------------------------------ */
/* Oeffentliche API                                                    */
/* ------------------------------------------------------------------ */

/**
 * HTML-Fragment (z. B. aus marked) -> normalisiertes Dokument. Laeuft
 * ebenfalls durch den Rewriter, damit eingebettetes Roh-HTML in
 * Markdown (script, Checkbox-Listen) gleich behandelt wird.
 */
export function htmlFragmentToDoc(html: string): { doc: JsonNode; dataUrls: string[] } {
  const { rules, dataUrls } = buildRules("markdown");
  const tokens = rewrite(tokenize(html), rules);
  return {
    doc: normalizeDoc(generateJSON(serialize(tokens), extensions) as JsonNode),
    dataUrls,
  };
}

export type HtmlResult = {
  title: string | null;
  doc: JsonNode;
  /** data:-Bilder, im Dokument durch DATA_IMAGE_PREFIX + Index ersetzt. */
  dataUrls: string[];
};

/** Vollstaendige HTML-Seite eines Exports -> Titel + Dokument. */
export function htmlToDoc(html: string, format: ImportFormat): HtmlResult {
  const tokens = tokenize(html);
  const title = extractTitle(tokens, format);
  const { rules, dataUrls } = buildRules(format);
  const content = rewrite(extractContent(tokens, format), rules);
  let doc = normalizeDoc(generateJSON(serialize(content), extensions) as JsonNode);
  if (title) doc = stripLeadingTitle(doc, title);
  return { title, doc, dataUrls };
}

/** Nur der Titel (fuer den Seitenbaum). */
export function htmlTitle(html: string, format: ImportFormat): string | null {
  return extractTitle(tokenize(html), format);
}

/* ------------------------------------------------------------------ */
/* Confluence-Struktur: index.html und Breadcrumbs                     */
/* ------------------------------------------------------------------ */

export type IndexEntry = { href: string; title: string; children: IndexEntry[] };

/** Verschachtelte <ul><li><a href> ... </li></ul> in einen Baum lesen. */
function parseNestedList(inner: Token[]): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const item of directItems(inner)) {
    let href: string | null = null;
    let title = "";
    const children: IndexEntry[] = [];
    for (let i = 0; i < item.inner.length; i++) {
      const t = item.inner[i];
      if (t.kind !== "open" || t.selfClosing) continue;
      if (t.name === "a" && href === null) {
        const body = findRegion(item.inner.slice(i), (o) => o === t) ?? [];
        href = t.attrs.get("href") ?? "";
        title = textOf(body) ?? "";
        i += body.length + 1;
        continue;
      }
      if (t.name === "ul" || t.name === "ol") {
        const body = findRegion(item.inner.slice(i), (o) => o === t) ?? [];
        children.push(...parseNestedList(body));
        i += body.length + 1;
      }
    }
    if (href) entries.push({ href, title, children });
  }
  return entries;
}

/**
 * Seitenhierarchie aus der index.html eines Confluence-HTML-Exports
 * ("Available Pages"). Leer, wenn keine Liste gefunden wird.
 */
export function parseConfluenceIndex(html: string): IndexEntry[] {
  const tokens = tokenize(html);
  const scope =
    region(tokens, "div", (t) => t.attrs.get("id") === "main-content") ??
    region(tokens, "body") ??
    tokens;
  const list = region(scope, "ul");
  if (!list) return [];
  return parseNestedList(list);
}

/**
 * Breadcrumb-Links einer Confluence-Seite (ohne index.html), in
 * Reihenfolge von der Wurzel her. Der letzte Eintrag ist die Elternseite.
 */
export function confluenceBreadcrumbs(html: string): string[] {
  const tokens = tokenize(html);
  const list = region(tokens, "ol", (t) => t.attrs.get("id") === "breadcrumbs");
  if (!list) return [];
  const hrefs: string[] = [];
  for (const t of list) {
    if (t.kind !== "open" || t.name !== "a") continue;
    const href = t.attrs.get("href");
    if (href && !/(^|\/)index\.html?$/i.test(href)) hrefs.push(href);
  }
  return hrefs;
}
