"use client";

import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Maximize2, Minimize2, Square, Text } from "lucide-react";
import { IMAGE_WIDTHS, type ImageWidth } from "@dokunc/editor";
import { cn } from "@/lib/cn";

const WIDTH_META: Record<
  ImageWidth,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  small: { icon: Minimize2, label: "Klein" },
  medium: { icon: Square, label: "Mittel" },
  full: { icon: Maximize2, label: "Volle Breite" },
};

/**
 * Bild mit Breite, Alternativtext und Bildunterschrift.
 *
 * Die Felder erscheinen nur im Bearbeitungsmodus und nur, wenn das Bild
 * ausgewählt ist — sonst stünde über jedem Bild eine Werkzeugleiste.
 */
export function ImageView({
  node,
  updateAttributes,
  selected,
  editor,
}: NodeViewProps) {
  const width = ((node.attrs.width as ImageWidth) ?? "full") as ImageWidth;
  const caption = (node.attrs.caption as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const [showAlt, setShowAlt] = useState(false);
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      as="figure"
      className={cn("dk-figure", selected && "dk-figure--selected")}
      data-width={width}
    >
      {editable && selected && (
        <div className="dk-figure-bar" contentEditable={false}>
          {IMAGE_WIDTHS.map((w) => {
            const Icon = WIDTH_META[w].icon;
            return (
              <button
                key={w}
                type="button"
                title={WIDTH_META[w].label}
                aria-label={WIDTH_META[w].label}
                aria-pressed={width === w}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateAttributes({ width: w })}
                className={cn("dk-figure-btn", width === w && "is-active")}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
          <button
            type="button"
            title="Alternativtext"
            aria-label="Alternativtext bearbeiten"
            aria-pressed={showAlt}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowAlt((v) => !v)}
            className={cn("dk-figure-btn", showAlt && "is-active")}
          >
            <Text className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <img
        src={String(node.attrs.src ?? "")}
        alt={alt}
        title={(node.attrs.title as string | null) ?? undefined}
        draggable={false}
      />

      {editable && selected && showAlt && (
        <input
          value={alt}
          contentEditable={false}
          placeholder="Alternativtext (für Screenreader und fehlende Bilder)"
          onChange={(e) => updateAttributes({ alt: e.target.value })}
          className="dk-figure-input"
        />
      )}

      {editable ? (
        (selected || caption) && (
          <input
            value={caption}
            contentEditable={false}
            placeholder="Bildunterschrift"
            onChange={(e) =>
              updateAttributes({ caption: e.target.value || null })
            }
            className="dk-figure-caption-input"
          />
        )
      ) : caption ? (
        <figcaption>{caption}</figcaption>
      ) : null}
    </NodeViewWrapper>
  );
}
