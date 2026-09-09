"use client";

import {
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Aufklappbarer Abschnitt.
 *
 * Der Körper wird beim Zuklappen nur ausgeblendet, nicht entfernt:
 * ProseMirror braucht seinen Inhalt durchgehend im DOM.
 */
export function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  const open = node.attrs.open !== false;
  const summary = String(node.attrs.summary ?? "");

  return (
    <NodeViewWrapper className={cn("dk-toggle", open && "is-open")}>
      <div className="dk-toggle-head" contentEditable={false}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Abschnitt zuklappen" : "Abschnitt aufklappen"}
          onClick={() => updateAttributes({ open: !open })}
          className="dk-toggle-caret"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {editor.isEditable ? (
          <input
            value={summary}
            placeholder="Überschrift des Abschnitts"
            onChange={(e) => updateAttributes({ summary: e.target.value })}
            className="dk-toggle-summary"
          />
        ) : (
          <span className="dk-toggle-summary">{summary}</span>
        )}
      </div>
      <NodeViewContent className="dk-toggle-body" />
    </NodeViewWrapper>
  );
}
