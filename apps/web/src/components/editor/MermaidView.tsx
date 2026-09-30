"use client";

import { useEffect, useId, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Pencil, Eye } from "lucide-react";
import { mermaidConfig } from "@/lib/mermaid-config";

/**
 * Zaehler fuer die id eines Rendervorgangs.
 *
 * mermaid.render(id) baut das SVG in einem Hilfselement unter dieser id
 * und sucht es waehrend des Zeichnens im ganzen Dokument per
 * `[id="…"]`. Das fertige SVG traegt dieselbe id, und genau das zeigt
 * die Ansicht an. Mit einer festen id je Block konnte die Suche das
 * angezeigte alte SVG treffen: "Vorschau" startet den Lauf schon, wenn
 * das Textfeld den Fokus verliert, und haengt erst danach das alte SVG
 * wieder ein. Muss mermaid fuer den Diagrammtyp noch einen Chunk
 * nachladen, steht das alte SVG beim Zeichnen wieder im Dokument,
 * mermaid zeichnet hinein, und das zurueckgegebene SVG blieb ohne
 * Knoten (so in mermaid 11.16.1 wie in 12.0.0). Eine eigene id je Lauf
 * faellt nie mit dem angezeigten Bild zusammen.
 *
 * Die Kehrseite: mermaid entfernt sein Hilfselement (`d` und die id) am
 * Anfang eines Laufs mit derselben id und am Ende eines gelungenen. Ein
 * gescheiterter Lauf liess es stehen, mit fester id nur bis zum naechsten
 * Lauf des Blocks, mit einer id je Lauf fuer immer: jeder Syntaxfehler
 * haengte ein Fehlerbild unter die App. Deshalb zeichnet mermaid kein
 * Fehlerbild (`suppressErrorRendering` in mermaidConfig), und die Ansicht
 * raeumt das Hilfselement nach jedem Lauf selbst weg.
 */
let renderLauf = 0;

export function MermaidView({ node, updateAttributes, editor }: NodeViewProps) {
  const code = (node.attrs.code as string) ?? "";
  const [editing, setEditing] = useState(false);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${rawId}-${++renderLauf}`;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize(
          mermaidConfig(document.documentElement.classList.contains("dark")),
        );
        const { svg } = await mermaid.render(id, code || " ");
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Diagrammfehler");
        }
      } finally {
        // Mit suppressErrorRendering raeumt mermaid bei Syntax- und
        // Zeichenfehlern selbst auf; wirft es an anderer Stelle (Stile,
        // Serialisieren), bliebe das Hilfselement stehen. mermaid arbeitet
        // render()-Aufrufe der Reihe nach ab, hier ist es mit der id fertig.
        document.getElementById(`d${id}`)?.remove();
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
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </NodeViewWrapper>
  );
}
