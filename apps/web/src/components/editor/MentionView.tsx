"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

export function MentionView({ node }: NodeViewProps) {
  const name = (node.attrs.name as string) || "Unbekannt";
  return (
    <NodeViewWrapper as="span" className="inline">
      <span className="dk-mention" contentEditable={false}>
        @{name}
      </span>
    </NodeViewWrapper>
  );
}
