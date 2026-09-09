import { isExternalUrl } from "./paths";
import type { JsonNode } from "./types";

/**
 * Umschreiben von Links und Bildern in einem konvertierten Dokument:
 * - Links auf importierte Seiten -> wikiLink-Knoten (pageId, label)
 * - Bilder aus dem Import -> als Anhang gespeichert, src = /api/files/..
 * - data:-Bilder ebenfalls als Upload
 * - externe http(s)-Bilder bleiben unveraendert (Hinweis)
 * Rein: alle Nebenwirkungen (Datei speichern, DB) kommen ueber `ctx`.
 */

export type ResolvedLink =
  | { kind: "page"; pageId: string; title: string }
  /** Datei im Import, die keine Seite ist (z. B. PDF). */
  | { kind: "file" }
  | null;

export type LinkContext = {
  /** href relativ zur aktuellen Datei -> Zielseite/-datei. */
  resolveLink: (href: string) => ResolvedLink;
  /** src (relativ oder data:) -> neue URL oder null, wenn nicht importierbar. */
  resolveImage: (src: string) => Promise<string | null>;
  warn: (message: string) => void;
};

function isAnchor(href: string): boolean {
  return href.trim().startsWith("#");
}

function shortHref(href: string): string {
  const s = href.length > 80 ? `${href.slice(0, 77)}...` : href;
  return s.startsWith("data:") ? "data:-Bild" : s;
}

async function rewriteInline(nodes: JsonNode[], ctx: LinkContext): Promise<JsonNode[]> {
  const out: JsonNode[] = [];
  for (const node of nodes) {
    const link = node.marks?.find((m) => m.type === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
    if (!link || href === null || node.type !== "text") {
      out.push(await rewriteNode(node, ctx));
      continue;
    }
    if (isExternalUrl(href)) {
      out.push(node);
      continue;
    }
    const others = (node.marks ?? []).filter((m) => m.type !== "link");
    const plain: JsonNode = { ...node, marks: others.length ? others : undefined };
    if (!plain.marks) delete plain.marks;

    if (isAnchor(href)) {
      out.push(plain);
      continue;
    }
    const resolved = ctx.resolveLink(href);
    if (resolved?.kind === "page") {
      const label = (node.text ?? "").trim() || resolved.title;
      out.push({
        type: "wikiLink",
        attrs: { pageId: resolved.pageId, label },
      });
      continue;
    }
    if (resolved?.kind === "file") {
      ctx.warn(`Anhang "${shortHref(href)}" wurde nicht importiert (nur Bilder werden übernommen).`);
    } else {
      ctx.warn(`Link "${shortHref(href)}" konnte keiner importierten Seite zugeordnet werden.`);
    }
    out.push(plain);
  }
  return out;
}

async function rewriteNode(node: JsonNode, ctx: LinkContext): Promise<JsonNode> {
  if (node.type === "image") {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    if (!src) return { type: "paragraph" };
    if (isExternalUrl(src)) {
      ctx.warn(`Externes Bild bleibt verlinkt: ${shortHref(src)}`);
      return node;
    }
    const url = await ctx.resolveImage(src);
    if (!url) {
      ctx.warn(`Bild "${shortHref(src)}" konnte nicht importiert werden.`);
      return { type: "paragraph" };
    }
    return { ...node, attrs: { ...node.attrs, src: url } };
  }
  if (!node.content) return node;
  const content = node.content.some((c) => c.type === "text" || c.type === "hardBreak")
    ? await rewriteInline(node.content, ctx)
    : await Promise.all(node.content.map((c) => rewriteNode(c, ctx)));
  return { ...node, content };
}

/** Links und Bilder eines Dokuments umschreiben (siehe Modulkommentar). */
export async function rewriteLinks(doc: JsonNode, ctx: LinkContext): Promise<JsonNode> {
  return rewriteNode(doc, ctx);
}

/** Alle wikiLink-Ziele eines Dokuments (fuer Backlinks). */
export function collectWikiLinkIds(doc: JsonNode): string[] {
  const ids = new Set<string>();
  const walk = (n: JsonNode) => {
    if (n.type === "wikiLink" && typeof n.attrs?.pageId === "string") {
      ids.add(n.attrs.pageId);
    }
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...ids];
}
