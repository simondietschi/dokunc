import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, RotateCcw, Eye, GitCompareArrows } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { toMarkdown } from "@/lib/markdown";
import { contentToHtml } from "@/lib/page-html";
import { diffText } from "@/lib/diff";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { DiffView, DiffSummary } from "@/components/history/DiffView";
import { restoreVersionAction } from "../../../../actions";

/**
 * Versionsvergleich: eine gespeicherte Version gegen den aktuellen Stand
 * oder gegen die vorherige Version, als Zeilen-/Wort-Diff auf Markdown-
 * Basis — oder als gerenderte Vorschau der Version.
 */

type Against = "current" | "previous";
type View = "diff" | "preview";

function versionMarkdown(title: string, content: unknown): string {
  return `# ${title}\n\n${toMarkdown(content)}`;
}

function formatTime(d: Date): string {
  return d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export default async function VersionComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; pageId: string; versionId: string }>;
  searchParams: Promise<{ against?: string; view?: string }>;
}) {
  const { slug, pageId, versionId } = await params;
  const query = await searchParams;
  const { space, role } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, deletedAt: null },
    select: { id: true, title: true, content: true, updatedAt: true },
  });
  if (!page) notFound();

  // Version strikt an Seite UND Space gebunden (IDs kommen aus der URL).
  const version = await prisma.pageVersion.findFirst({
    where: { id: versionId, pageId: page.id, page: { spaceId: space.id } },
    include: { author: { select: { name: true } } },
  });
  if (!version) notFound();

  const previous = await prisma.pageVersion.findFirst({
    where: { pageId: page.id, createdAt: { lt: version.createdAt } },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true } } },
  });

  const against: Against =
    query.against === "previous" && previous ? "previous" : "current";
  const view: View = query.view === "preview" ? "preview" : "diff";

  const versionText = versionMarkdown(version.title, version.content);
  const oldText =
    against === "previous" && previous
      ? versionMarkdown(previous.title, previous.content)
      : versionText;
  const newText =
    against === "previous"
      ? versionText
      : versionMarkdown(page.title, page.content);
  const diff = view === "diff" ? diffText(oldText, newText) : null;
  const previewHtml = view === "preview" ? contentToHtml(version.content) : "";

  const base = `/s/${slug}/p/${page.id}/history/${version.id}`;
  const href = (a: Against, v: View) => `${base}?against=${a}&view=${v}`;
  const canRestore = can(role, "write");

  const fromLabel =
    against === "previous" && previous
      ? `Vorherige Version (${formatTime(previous.createdAt)})`
      : `Diese Version (${formatTime(version.createdAt)})`;
  const toLabel =
    against === "previous"
      ? `Diese Version (${formatTime(version.createdAt)})`
      : `Aktueller Stand (${formatTime(page.updatedAt)})`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-14 animate-[rise_0.4s_ease] sm:px-8">
      <Link
        href={`/s/${slug}/p/${page.id}/history`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück zum Verlauf
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            Version vom {formatTime(version.createdAt)}
          </h1>
          <p className="mt-1 truncate text-sm text-muted">{page.title}</p>
          <div className="mt-3 flex items-center gap-2.5">
            <Avatar name={version.author?.name ?? "System"} size={28} />
            <div className="text-sm">
              <span className="font-medium">
                {version.author?.name ?? "System"}
              </span>
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-faint">
                <Clock className="h-3 w-3" />
                {formatTime(version.createdAt)}
              </span>
            </div>
          </div>
        </div>
        {canRestore && (
          <form action={restoreVersionAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="versionId" value={version.id} />
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-subtle">
              <RotateCcw className="h-3.5 w-3.5" />
              Diese Version wiederherstellen
            </button>
          </form>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Vergleichen"
          items={[
            {
              key: "current",
              label: "gegen aktuellen Stand",
              href: href("current", view),
              active: against === "current",
            },
            {
              key: "previous",
              label: "gegen vorherige Version",
              href: href("previous", view),
              active: against === "previous",
              disabled: !previous,
              title: previous ? undefined : "Keine ältere Version vorhanden",
            },
          ]}
        />
        <Segmented
          label="Ansicht"
          items={[
            {
              key: "diff",
              label: "Änderungen",
              href: href(against, "diff"),
              active: view === "diff",
              icon: <GitCompareArrows className="h-3.5 w-3.5" />,
            },
            {
              key: "preview",
              label: "Vorschau",
              href: href(against, "preview"),
              active: view === "preview",
              icon: <Eye className="h-3.5 w-3.5" />,
            },
          ]}
        />
      </div>

      <section className="mt-4 overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
        {view === "diff" && diff ? (
          <>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-subtle/60 px-4 py-2.5">
              <p className="min-w-0 text-[13px] text-muted">
                <span className="text-ink">{fromLabel}</span>
                <span className="mx-1.5 text-faint">→</span>
                <span className="text-ink">{toLabel}</span>
              </p>
              <DiffSummary added={diff.added} removed={diff.removed} />
            </header>
            <div className="overflow-x-auto py-2" data-testid="diff-view">
              <DiffView blocks={diff.blocks} />
            </div>
          </>
        ) : (
          <>
            <header className="border-b border-line bg-subtle/60 px-4 py-2.5">
              <p className="text-[13px] text-muted">
                Vorschau von{" "}
                <span className="text-ink">
                  {formatTime(version.createdAt)}
                </span>
              </p>
            </header>
            <article className="px-6 py-6 sm:px-8" data-testid="version-preview">
              <h1 className="mb-6 text-3xl font-bold tracking-tight">
                {version.title}
              </h1>
              {previewHtml ? (
                // HTML entsteht ausschliesslich serverseitig aus dem
                // ProseMirror-JSON ueber das geteilte Editor-Schema
                // (contentToHtml) — kein Roh-HTML aus Nutzerdaten.
                <div
                  className="ProseMirror min-h-0!"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <p className="text-sm text-faint">Diese Version ist leer.</p>
              )}
            </article>
          </>
        )}
      </section>
    </div>
  );
}

function Segmented({
  label,
  items,
}: {
  label: string;
  items: {
    key: string;
    label: string;
    href: string;
    active: boolean;
    disabled?: boolean;
    title?: string;
    icon?: React.ReactNode;
  }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-subtle p-0.5"
    >
      {items.map((it) => {
        const cls = cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
          it.active
            ? "bg-surface text-ink shadow-soft"
            : "text-muted hover:text-ink",
          it.disabled && "cursor-not-allowed opacity-50 hover:text-muted",
        );
        if (it.disabled) {
          return (
            <span key={it.key} className={cls} title={it.title} aria-disabled>
              {it.icon}
              {it.label}
            </span>
          );
        }
        return (
          <Link
            key={it.key}
            href={it.href}
            className={cls}
            aria-current={it.active ? "page" : undefined}
          >
            {it.icon}
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
