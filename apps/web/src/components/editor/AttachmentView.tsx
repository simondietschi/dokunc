"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
} from "lucide-react";
import { formatBytes } from "@dokunc/editor";
import { cn } from "@/lib/cn";

const ICONS = {
  image: FileImage,
  document: FileText,
  archive: FileArchive,
  sheet: FileSpreadsheet,
  code: FileCode,
  other: Paperclip,
} as const;

/** Symbolgruppe nach Dateityp — grob, aber genug zum Wiedererkennen. */
function iconKeyFor(mime: string, name: string): keyof typeof ICONS {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "document";
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return "archive";
  if (["csv", "xls", "xlsx", "ods"].includes(ext)) return "sheet";
  if (
    ["json", "yml", "yaml", "xml", "ts", "js", "py", "sql", "log"].includes(ext)
  ) {
    return "code";
  }
  return "other";
}

export function AttachmentView({ node, selected }: NodeViewProps) {
  const name = String(node.attrs.name ?? "Datei");
  const url = String(node.attrs.url ?? "");
  const size = Number(node.attrs.size ?? 0);
  const Icon = ICONS[iconKeyFor(String(node.attrs.mime ?? ""), name)];

  return (
    <NodeViewWrapper className="dk-attachment-wrap">
      <a
        href={url}
        download={name}
        // Ein Anhang gehört zum Dokument, nicht zur Bearbeitung: der
        // Link bleibt auch im Editor klickbar.
        contentEditable={false}
        className={cn("dk-attachment", selected && "dk-attachment--selected")}
      >
        <Icon className="h-5 w-5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">
            {name}
          </span>
          <span className="block text-[11.5px] text-faint">
            {formatBytes(size)}
          </span>
        </span>
      </a>
    </NodeViewWrapper>
  );
}
