import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";

/**
 * Eine lowlight-Instanz für Client, Collab-Server und Export.
 * `common` deckt die gängigen Sprachen ab (~35 Grammatiken), ohne das
 * Bundle mit allen 190 highlight.js-Sprachen zu belasten.
 */
export const lowlight = createLowlight(common);

/** Anzeigename je Sprach-ID (Rest wird kapitalisiert). */
const LABELS: Record<string, string> = {
  plaintext: "Text",
  bash: "Bash",
  shell: "Shell",
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  yaml: "YAML",
  xml: "HTML / XML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  markdown: "Markdown",
  python: "Python",
  "python-repl": "Python REPL",
  go: "Go",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  objectivec: "Objective-C",
  php: "PHP",
  "php-template": "PHP Template",
  ruby: "Ruby",
  perl: "Perl",
  lua: "Lua",
  r: "R",
  sql: "SQL",
  graphql: "GraphQL",
  ini: "INI / TOML",
  makefile: "Makefile",
  diff: "Diff",
  arduino: "Arduino",
  vbnet: "VB.NET",
  wasm: "WebAssembly",
};

/** Häufige Sprachen zuerst, der Rest alphabetisch. */
const FIRST = [
  "plaintext",
  "bash",
  "typescript",
  "javascript",
  "json",
  "yaml",
  "python",
  "go",
  "rust",
  "java",
  "sql",
  "xml",
  "css",
  "markdown",
];

export type CodeLanguage = { id: string; label: string };

export const CODE_LANGUAGES: CodeLanguage[] = (() => {
  const all = lowlight.listLanguages();
  const rest = all.filter((l) => !FIRST.includes(l)).sort();
  return [...FIRST.filter((l) => all.includes(l)), ...rest].map((id) => ({
    id,
    label: LABELS[id] ?? id[0].toUpperCase() + id.slice(1),
  }));
})();

/**
 * Codeblock mit Syntax-Highlighting. Gleicher Node-Name/gleiche Attribute
 * wie der StarterKit-Codeblock (`codeBlock`, `language`), d. h. bestehende
 * Dokumente bleiben kompatibel. Das Highlighting selbst sind reine
 * Editor-Decorations; Yjs/JSON enthalten weiterhin nur Klartext.
 */
export const CodeBlockHighlight = CodeBlockLowlight.configure({
  lowlight,
  defaultLanguage: null,
  languageClassPrefix: "language-",
  // Tab rückt im Codeblock ein, statt den Fokus aus dem Editor zu nehmen.
  enableTabIndentation: true,
  tabSize: 2,
});

type HastNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      tagName: string;
      properties?: { className?: string[] | string };
      children: HastNode[];
    }
  | { type: "root"; children: HastNode[] }
  | { type: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hastToHtml(node: HastNode): string {
  if (node.type === "text") return esc((node as { value: string }).value);
  if (node.type === "element") {
    const el = node as Extract<HastNode, { type: "element" }>;
    const cls = el.properties?.className;
    const classAttr = cls
      ? ` class="${esc(Array.isArray(cls) ? cls.join(" ") : String(cls))}"`
      : "";
    return `<${el.tagName}${classAttr}>${el.children.map(hastToHtml).join("")}</${el.tagName}>`;
  }
  if ("children" in node && Array.isArray((node as { children: HastNode[] }).children)) {
    return (node as { children: HastNode[] }).children.map(hastToHtml).join("");
  }
  return "";
}

/**
 * Highlightet Code serverseitig zu HTML (`<span class="hljs-…">`).
 * Unbekannte Sprache -> escaped Klartext. Für den HTML/PDF-Export.
 */
export function highlightToHtml(code: string, language?: string | null): string {
  const lang = language?.trim().toLowerCase();
  if (!lang || !lowlight.registered(lang)) return esc(code);
  try {
    return hastToHtml(lowlight.highlight(lang, code) as HastNode);
  } catch {
    return esc(code);
  }
}
