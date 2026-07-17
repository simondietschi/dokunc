"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Pencil, Network } from "lucide-react";
import { toBase64 } from "@dokunc/editor";
import { Button } from "@/components/ui/Button";

const DRAWIO_ORIGIN = "https://embed.diagrams.net";
const DRAWIO_URL = `${DRAWIO_ORIGIN}/?embed=1&proto=json&spin=1&ui=min&noSaveBtn=1&saveAndExit=1`;

export function DrawioView({ node, updateAttributes, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const xml = (node.attrs.xml as string) ?? "";
  const svg = (node.attrs.svg as string) ?? "";

  return (
    <NodeViewWrapper className="dk-diagram" data-diagram="drawio">
      <div className="dk-diagram-bar" contentEditable={false}>
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide opacity-60">
          <Network className="h-3.5 w-3.5" />
          draw.io
        </span>
        {editor.isEditable && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] opacity-70 hover:bg-subtle hover:opacity-100"
          >
            <Pencil className="h-3.5 w-3.5" /> Bearbeiten
          </button>
        )}
      </div>

      {svg ? (
        <img
          src={`data:image/svg+xml;base64,${toBase64(svg)}`}
          alt="draw.io-Diagramm"
          className="dk-diagram-img"
          draggable={false}
        />
      ) : (
        <button
          type="button"
          disabled={!editor.isEditable}
          onClick={() => setEditing(true)}
          className="dk-diagram-empty"
        >
          <Network className="h-5 w-5" />
          Leeres Diagramm — klicken zum Bearbeiten (lädt embed.diagrams.net)
        </button>
      )}

      {editing && (
        <DrawioModal
          xml={xml}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            updateAttributes({ xml: next.xml, svg: next.svg });
            setEditing(false);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

/**
 * draw.io Embed-Protokoll (proto=json):
 *   init  -> wir senden {action:"load", xml}
 *   save  -> wir fordern {action:"export", format:"xmlsvg"} an
 *   export-> data:image/svg+xml;base64,... (SVG enthält das XML) -> speichern
 *   exit  -> abbrechen
 */
function DrawioModal({
  xml,
  onSave,
  onCancel,
}: {
  xml: string;
  onSave: (result: { xml: string; svg: string }) => void;
  onCancel: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const latestXml = useRef(xml);

  const post = useCallback((msg: object) => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify(msg),
      DRAWIO_ORIGIN,
    );
  }, []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== DRAWIO_ORIGIN || typeof e.data !== "string") return;
      let msg: {
        event?: string;
        xml?: string;
        data?: string;
        exit?: boolean;
      };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.event) {
        case "init":
          post({ action: "load", xml: latestXml.current, autosave: 0 });
          break;
        case "save":
          if (msg.xml) latestXml.current = msg.xml;
          post({ action: "export", format: "xmlsvg" });
          break;
        case "export": {
          const data = msg.data ?? "";
          const prefix = "data:image/svg+xml;base64,";
          const svg = data.startsWith(prefix)
            ? decodeBase64Utf8(data.slice(prefix.length))
            : "";
          onSave({ xml: msg.xml ?? latestXml.current, svg });
          break;
        }
        case "exit":
          onCancel();
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post, onSave, onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-canvas">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="text-sm font-semibold">
          draw.io{" "}
          <span className="font-normal text-faint">
            (embed.diagrams.net — Diagrammdaten bleiben lokal)
          </span>
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
      <iframe
        ref={frameRef}
        src={DRAWIO_URL}
        title="draw.io Editor"
        className="min-h-0 flex-1 border-0"
      />
    </div>,
    document.body,
  );
}

function decodeBase64Utf8(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
