"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Pencil, Network } from "lucide-react";
import { toBase64 } from "@dokunc/editor";
import { FullscreenDialog } from "@/components/ui/FullscreenDialog";

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
 *   init  -> wir senden {action:"load", xml, autosave:1}
 *   autosave -> {xml} nach jeder Aenderung: merken, dass es etwas zu
 *            verlieren gibt (Rueckfrage beim Abbrechen)
 *   save  -> wir fordern {action:"export", format:"xmlsvg"} an
 *   export-> data:image/svg+xml;base64,... (SVG enthält das XML) -> speichern
 *   exit  -> abbrechen (fragt draw.io bei Aenderungen selbst nach)
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
  // Hat draw.io eine Aenderung gemeldet? Der Editor laeuft in einem
  // fremden iframe; ohne diese Meldung wuesste "Abbrechen" (und Escape
  // im Kopf des Fensters) nicht, ob es etwas verwirft.
  const changed = useRef(false);

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
          post({ action: "load", xml: latestXml.current, autosave: 1 });
          break;
        case "autosave":
          // Nur echte Abweichungen zaehlen. Liefert draw.io dasselbe
          // Diagramm in anderer Schreibweise zurueck, wird einmal zu oft
          // gefragt, nie einmal zu wenig.
          if (typeof msg.xml === "string" && msg.xml !== xml) {
            changed.current = true;
            latestXml.current = msg.xml;
          }
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
  }, [post, onSave, onCancel, xml]);

  return (
    <FullscreenDialog
      title="draw.io-Diagramm"
      description="embed.diagrams.net — Diagrammdaten bleiben lokal"
      onCancel={onCancel}
      hasUnsavedChanges={() => changed.current}
    >
      <iframe
        ref={frameRef}
        src={DRAWIO_URL}
        title="draw.io Editor"
        className="min-h-0 flex-1 border-0"
      />
    </FullscreenDialog>
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
