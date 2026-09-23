"use client";

import { useRef, useState } from "react";
import { Excalidraw, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FullscreenDialog } from "@/components/ui/FullscreenDialog";
import { sceneSignature } from "@/lib/excalidraw-scene";

type SceneData = {
  elements?: readonly unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

function parseScene(data: string): SceneData | undefined {
  if (!data) return undefined;
  try {
    return JSON.parse(data) as SceneData;
  } catch {
    return undefined;
  }
}

/**
 * Alles, was Excalidraw selbst rendert, traegt die Klasse `excalidraw`:
 * die Zeichenflaeche und auch die Fenster, die es an body haengt (Hilfe,
 * Export, Bibliothek). Dort gehoert Escape dem Editor.
 */
function isExcalidrawSurface(el: Element): boolean {
  return el.closest(".excalidraw") !== null;
}

export function ExcalidrawModal({
  initialData,
  onSave,
  onCancel,
}: {
  initialData: string;
  onSave: (result: { data: string; svg: string }) => void;
  onCancel: () => void;
}) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // Stand direkt nach dem Laden der Szene, zum Vergleich beim
  // Schliessen. Excalidraw meldet onChange erst, wenn die Szene geladen
  // ist; die erste Meldung ist also der Ausgangsstand.
  const ausgangRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  async function save() {
    const api = apiRef.current;
    if (!api) return;
    setSaving(true);
    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();

      const data = JSON.stringify({
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
        files,
      });

      let svg = "";
      if (elements.length > 0) {
        const svgEl = await exportToSvg({
          elements,
          appState: {
            ...appState,
            exportBackground: false,
            exportWithDarkMode: false,
          },
          files,
        });
        svg = new XMLSerializer().serializeToString(svgEl);
      }
      onSave({ data, svg });
    } finally {
      setSaving(false);
    }
  }

  /** Wuerde "Abbrechen" jetzt etwas verwerfen? */
  function hasUnsavedChanges(): boolean {
    const api = apiRef.current;
    // Noch nicht geladen: dann kann auch niemand etwas gezeichnet haben.
    if (!api || ausgangRef.current === null) return false;
    return (
      sceneSignature(
        api.getSceneElements(),
        api.getAppState().viewBackgroundColor,
      ) !== ausgangRef.current
    );
  }

  const scene = parseScene(initialData);

  return (
    <FullscreenDialog
      title="Excalidraw-Zeichnung"
      onCancel={onCancel}
      hasUnsavedChanges={hasUnsavedChanges}
      surface={isExcalidrawSurface}
      actions={
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Übernehmen"
          )}
        </Button>
      }
    >
      <div className="min-h-0 flex-1">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
          onChange={(elements, appState) => {
            if (ausgangRef.current !== null) return;
            ausgangRef.current = sceneSignature(
              elements,
              appState.viewBackgroundColor,
            );
          }}
          initialData={
            scene
              ? {
                  elements: (scene.elements ?? []) as never,
                  appState: (scene.appState ?? {}) as never,
                  files: (scene.files ?? {}) as never,
                }
              : undefined
          }
          theme={dark ? "dark" : "light"}
          langCode="de-DE"
        />
      </div>
    </FullscreenDialog>
  );
}
