"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatFileSize, fileIconKind, type FileIconKind } from "@/lib/file-meta";

const ICONS: Record<FileIconKind, LucideIcon> = {
  image: FileImage,
  pdf: FileText,
  text: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: FileArchive,
  audio: FileAudio,
  video: FileVideo,
  code: FileCode2,
  file: File,
};

/** Kurze Typbezeichnung fuer die zweite Zeile der Karte. */
function typeLabel(mimeType: string, name: string): string {
  const idx = name.lastIndexOf(".");
  const ext = idx >= 0 ? name.slice(idx + 1).toUpperCase() : "";
  if (ext && ext.length <= 8) return ext;
  return mimeType && mimeType !== "application/octet-stream"
    ? mimeType
    : "Datei";
}

/**
 * Anhang-Karte im Editor: Symbol nach Typ, Name, Groesse, Download.
 * Atom-Node: selektierbar (Klick auf die Karte) und per Backspace/Entf
 * loeschbar wie andere Bloecke.
 */
export function AttachmentView({ node, selected }: NodeViewProps) {
  const src = String(node.attrs.src ?? "");
  const name = String(node.attrs.name ?? "Datei");
  const size = Number(node.attrs.size ?? 0);
  const mimeType = String(node.attrs.mimeType ?? "");
  const Icon = ICONS[fileIconKind(mimeType, name)];
  const isPdf = mimeType === "application/pdf";

  return (
    <NodeViewWrapper
      className="dk-attachment-wrap"
      data-attachment=""
      data-drag-handle=""
    >
      <div
        className={cn(
          "dk-attachment",
          "flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 transition-colors",
          selected ? "ring-2 ring-accent/60 border-transparent" : "hover:border-line-strong",
        )}
        contentEditable={false}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-subtle text-muted">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <a
            href={src}
            target="_self"
            className="dk-attachment-name block truncate text-[14px] font-medium text-ink no-underline hover:underline"
            title={name}
            data-attachment-link=""
          >
            {name}
          </a>
          <span className="block text-[12px] text-faint">
            {typeLabel(mimeType, name)}
            {size > 0 ? ` · ${formatFileSize(size)}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {isPdf && (
            <a
              href={`${src}${src.includes("?") ? "&" : "?"}inline=1`}
              target="_blank"
              rel="noreferrer"
              title="Im Browser öffnen"
              aria-label="Im Browser öffnen"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <a
            href={src}
            target="_self"
            title="Herunterladen"
            aria-label="Herunterladen"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <Download className="h-4 w-4" />
          </a>
        </span>
      </div>
    </NodeViewWrapper>
  );
}
