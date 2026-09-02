"use client";

import { useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { CODE_LANGUAGES } from "@dokunc/editor";

/**
 * Codeblock mit Sprachauswahl und Kopieren-Knopf. Das Highlighting
 * kommt aus der lowlight-Extension (Decorations), hier nur die Hülle.
 */
export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? "";
  const [copied, setCopied] = useState(false);
  const label =
    CODE_LANGUAGES.find((l) => l.id === language)?.label ?? "Text";

  async function copy() {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard nicht verfügbar (z. B. ohne HTTPS) */
    }
  }

  return (
    <NodeViewWrapper className="dk-code">
      <div className="dk-code-bar" contentEditable={false}>
        {editor.isEditable ? (
          <select
            value={language}
            onChange={(e) =>
              updateAttributes({ language: e.target.value || null })
            }
            aria-label="Sprache"
            className="dk-code-lang"
          >
            <option value="">Text</option>
            {CODE_LANGUAGES.filter((l) => l.id !== "plaintext").map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="dk-code-lang">{label}</span>
        )}
        <button
          type="button"
          onClick={copy}
          className="dk-code-copy"
          title="Code kopieren"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> Kopiert
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Kopieren
            </>
          )}
        </button>
      </div>
      <pre spellCheck={false}>
        <NodeViewContent<"code">
          as="code"
          className={language ? `language-${language}` : undefined}
        />
      </pre>
    </NodeViewWrapper>
  );
}
