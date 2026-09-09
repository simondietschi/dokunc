"use client";

import { useState } from "react";
import {
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { CODE_LANGUAGES } from "@dokunc/editor";

/**
 * Code-Block mit Sprachwahl und Kopieren.
 *
 * Die Hervorhebung selbst kommt aus lowlight als ProseMirror-Dekoration;
 * hier hängt nur die Bedienleiste daran. `contentEditable={false}` an der
 * Leiste ist wichtig, sonst tippt man beim Klicken in den Code.
 */
export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? "";
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ohne Zwischenablage-Recht bleibt der Knopf wirkungslos */
    }
  }

  return (
    <NodeViewWrapper className="dk-code-wrap">
      <div className="dk-code-bar" contentEditable={false}>
        {editor.isEditable ? (
          <select
            value={language}
            aria-label="Sprache des Code-Blocks"
            onChange={(e) => updateAttributes({ language: e.target.value })}
            className="dk-code-lang"
          >
            <option value="">Klartext</option>
            {CODE_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        ) : (
          <span className="dk-code-lang">{language || "Klartext"}</span>
        )}
        <button
          type="button"
          onClick={copy}
          title="Code kopieren"
          aria-label="Code kopieren"
          className="dk-code-copy"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
