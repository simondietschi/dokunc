"use client";

import { useEffect, useId, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Pencil, Eye } from "lucide-react";

export function MermaidView({ node, updateAttributes, editor }: NodeViewProps) {
  const code = (node.attrs.code as string) ?? "";
  const [editing, setEditing] = useState(false);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark")
            ? "dark"
            : "default",
        });
        const { svg } = await mermaid.render(`mmd-${rawId}`, code || " ");
        if (!cancelled && mounted.current) {
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled && mounted.current) {
          setError(e instanceof Error ? e.message : "Diagrammfehler");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, rawId]);

  return (
    <NodeViewWrapper className="dk-mermaid">
      <div className="dk-mermaid-bar" contentEditable={false}>
        <span className="text-[11px] uppercase tracking-wide opacity-60">
          Mermaid
        </span>
        {editor.isEditable && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] opacity-70 hover:bg-subtle hover:opacity-100"
          >
            {editing ? (
              <>
                <Eye className="h-3.5 w-3.5" /> Vorschau
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5" /> Bearbeiten
              </>
            )}
          </button>
        )}
      </div>

      {editing ? (
        <textarea
          defaultValue={code}
          spellCheck={false}
          onBlur={(e) => updateAttributes({ code: e.target.value })}
          className="dk-mermaid-editor"
          rows={Math.max(4, code.split("\n").length + 1)}
        />
      ) : error ? (
        <pre className="dk-mermaid-error">{error}</pre>
      ) : (
        <div
          className="dk-mermaid-render"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </NodeViewWrapper>
  );
}
