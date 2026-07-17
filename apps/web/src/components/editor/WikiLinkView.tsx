"use client";

import Link from "next/link";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { FileText } from "lucide-react";

/** Chip-Darstellung eines Wiki-Links; navigiert über /p/[pageId]. */
export function WikiLinkView({ node }: NodeViewProps) {
  const pageId = node.attrs.pageId as string | null;
  const label = (node.attrs.label as string) || "Seite";

  return (
    <NodeViewWrapper as="span" className="inline">
      <Link
        href={pageId ? `/p/${pageId}` : "#"}
        className="dk-wikilink"
        contentEditable={false}
        draggable={false}
      >
        <FileText className="dk-wikilink-icon" aria-hidden />
        {label}
      </Link>
    </NodeViewWrapper>
  );
}
