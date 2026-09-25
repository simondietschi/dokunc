import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, HardDrive } from "lucide-react";
import { requireAdmin } from "@/lib/current-user";
import { largestDocumentsFor } from "@/lib/doc-sizes";
import { formatFileSize } from "@/lib/file-meta";
import { relativeTime } from "@/lib/relative-time";

export const metadata: Metadata = {
  title: "Grösste Seiten",
  description: "Die grössten Seiten dieser Instanz nach Bearbeitungsstand.",
};

const LIMIT = 20;

export default async function DocumentsPage() {
  const admin = await requireAdmin();
  const { rows, limits } = await largestDocumentsFor(admin.id, LIMIT);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 animate-[rise_0.4s_ease]">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Administration
      </Link>
      <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <HardDrive className="h-5 w-5 text-muted" />
        Grösste Seiten
      </h1>
      <p className="mt-1 text-sm text-muted">
        {limits.maxDocBytes > 0
          ? `Die ${LIMIT} grössten Seiten nach Grösse ihres gespeicherten Bearbeitungsstands. Ab ${formatFileSize(limits.warnDocBytes)} erscheint ein Hinweis im Editor, über ${formatFileSize(limits.maxDocBytes)} kann die Seite nur noch gelesen werden (COLLAB_MAX_DOC_MB).`
          : `Die ${LIMIT} grössten Seiten nach Grösse ihres gespeicherten Bearbeitungsstands. Keine Grössengrenze gesetzt (COLLAB_MAX_DOC_MB=0).`}
      </p>

      {rows.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-line-strong bg-subtle/40 px-4 py-10 text-center text-sm text-muted">
          Noch keine gespeicherten Seiten.
        </p>
      ) : (
        <ul className="mt-6 space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.pageId}
              className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] shadow-soft"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-ink">
                  {row.title === null ? (
                    <span className="font-normal text-faint">
                      Seite ohne Zugriff
                    </span>
                  ) : row.href ? (
                    <Link href={row.href} className="hover:underline">
                      {row.title || "Ohne Titel"}
                    </Link>
                  ) : (
                    row.title || "Ohne Titel"
                  )}
                  {row.level === "frozen" && (
                    <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
                      nur lesbar
                    </span>
                  )}
                  {row.level === "warn" && (
                    <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                      Warnschwelle
                    </span>
                  )}
                  {row.inTrash && (
                    <span className="ml-2 rounded bg-subtle px-1.5 py-0.5 text-[11px] font-medium text-muted">
                      im Papierkorb
                    </span>
                  )}
                </span>
                <span className="font-mono text-[12px] text-ink">
                  {formatFileSize(row.bytes)}
                </span>
              </div>
              <p className="mt-1 text-muted">
                Space {row.spaceName} · gespeichert{" "}
                <time dateTime={row.updatedAt.toISOString()}>
                  {relativeTime(row.updatedAt)}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
