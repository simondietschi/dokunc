import type { JsonNode } from "./types";

const decoder = new TextDecoder("utf-8", { fatal: false });

/** Bytes als UTF-8-Text (ohne BOM, Zeilenenden normalisiert). */
export function decodeText(bytes: Uint8Array): string {
  let text = decoder.decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, "\n");
}

/** Nur den Anfang einer Datei dekodieren (Format-Erkennung). */
export function decodeHead(bytes: Uint8Array, max = 64 * 1024): string {
  return decodeText(bytes.length > max ? bytes.subarray(0, max) : bytes);
}

/**
 * Plain-Text aus ProseMirror-JSON (fuer Page.textContent / Suche).
 * Entspricht der Extraktion im Collab-Server.
 */
export function extractText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as JsonNode;
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (n.type === "mermaid" && typeof n.attrs?.code === "string") {
    return n.attrs.code;
  }
  if (n.type === "wikiLink" && typeof n.attrs?.label === "string") {
    return n.attrs.label;
  }
  if (Array.isArray(n.content)) {
    return n.content.map(extractText).join(" ");
  }
  return "";
}

/** HTML-Entities in reinem Text aufloesen (Titel, Link-Labels). */
export function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return s.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, code: string) => {
      const lower = code.toLowerCase();
      if (lower.startsWith("#x")) {
        const n = parseInt(lower.slice(2), 16);
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      if (lower.startsWith("#")) {
        const n = parseInt(lower.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      return named[lower] ?? match;
    },
  );
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
