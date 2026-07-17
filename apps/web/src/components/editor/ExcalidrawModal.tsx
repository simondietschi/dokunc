"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Excalidraw, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

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

  const scene = parseScene(initialData);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-canvas">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="text-sm font-semibold">Excalidraw</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Übernehmen"
            )}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
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
    </div>,
    document.body,
  );
}
