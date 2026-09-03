import {
  Download,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Paperclip,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { formatFileSize, fileIconKind, type FileIconKind } from "@/lib/file-meta";

export type PageAttachmentItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  createdAt: Date;
  uploader: string | null;
};

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

const dateFormat = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Abschnitt "Anhaenge" unter einer Seite: alle auf dieser Seite hoch-
 * geladenen Dateien (auch Bilder) als Download-Links. Server-Komponente.
 */
export function PageAttachments({ items }: { items: PageAttachmentItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-4 border-t border-line pt-6" data-page-attachments="">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        <Paperclip className="h-3.5 w-3.5" />
        Anhänge
        <span className="font-normal text-faint">({items.length})</span>
      </h2>
      <ul className="mt-2.5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {items.map((item) => {
          const Icon = ICONS[fileIconKind(item.mimeType, item.name)];
          return (
            <li key={item.id}>
              <a
                href={item.url}
                download={item.name}
                className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-subtle"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-subtle text-muted">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {item.name}
                  </span>
                  <span className="block truncate text-[12px] text-faint">
                    {formatFileSize(item.size)}
                    {" · "}
                    {dateFormat.format(item.createdAt)}
                    {item.uploader ? ` · ${item.uploader}` : ""}
                  </span>
                </span>
                <Download className="h-4 w-4 shrink-0 text-faint" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
