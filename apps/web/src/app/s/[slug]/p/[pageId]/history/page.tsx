import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  RotateCcw,
  Clock,
  GitCompareArrows,
  X,
} from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { toMarkdown } from "@/lib/markdown";
import { diffStats, diffText } from "@/lib/diff";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { restoreVersionAction } from "../../../actions";
import { DiffView } from "./DiffView";

const fmt = (d: Date) =>
  d.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; pageId: string }>;
  searchParams: Promise<{ v?: string; base?: string }>;
}) {
  const { slug, pageId } = await params;
  const { v, base } = await searchParams;
  const { space, role } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, deletedAt: null },
    select: { id: true, title: true, content: true },
  });
  if (!page) notFound();

  const versions = await prisma.pageVersion.findMany({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true } } },
  });
  const canRestore = can(role, "write");

  // Vergleich: gewählte Version gegen die vorherige (älter) oder gegen
  // den aktuellen Stand der Seite.
  const selectedIndex = v ? versions.findIndex((x) => x.id === v) : -1;
  const selected = selectedIndex >= 0 ? versions[selectedIndex] : null;
  const againstCurrent = base === "current";
  let diff: {
    lines: ReturnType<typeof diffText>;
    fromLabel: string;
    toLabel: string;
  } | null = null;
  if (selected) {
    const older = versions[selectedIndex + 1] ?? null;
    if (againstCurrent) {
      diff = {
        lines: diffText(
          `# ${selected.title}\n\n${toMarkdown(selected.content)}`,
          `# ${page.title}\n\n${toMarkdown(page.content)}`,
        ),
        fromLabel: `Version vom ${fmt(selected.createdAt)}`,
        toLabel: "Aktueller Stand",
      };
    } else {
      diff = {
        lines: diffText(
          older ? `# ${older.title}\n\n${toMarkdown(older.content)}` : "",
          `# ${selected.title}\n\n${toMarkdown(selected.content)}`,
        ),
        fromLabel: older
          ? `Vorherige Version (${fmt(older.createdAt)})`
          : "Leere Seite (erste Version)",
        toLabel: `Version vom ${fmt(selected.createdAt)}`,
      };
    }
  }
  const stats = diff ? diffStats(diff.lines) : null;

  const href = (versionId: string, b: "prev" | "current") =>
    `/s/${slug}/p/${pageId}/history?v=${versionId}&base=${b}`;

  return (
    <div
      className={cn(
        "mx-auto px-8 py-14 animate-[rise_0.4s_ease]",
        diff ? "max-w-5xl" : "max-w-2xl",
      )}
    >
      <Link
        href={`/s/${slug}/p/${pageId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück zur Seite
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Versionsverlauf
      </h1>
      <p className="mt-1 text-sm text-muted">{page.title}</p>

      <div className={cn("mt-8", diff && "grid gap-8 lg:grid-cols-[300px_1fr]")}>
        <ol className="space-y-1 border-l border-line pl-6">
          {versions.map((ver) => {
            const isSel = selected?.id === ver.id;
            return (
              <li key={ver.id} className="relative pb-5">
                <span
                  className={cn(
                    "absolute -left-[1.7rem] top-1 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-canvas",
                    isSel ? "bg-accent ring-2 ring-accent/40" : "bg-accent",
                  )}
                />
                <div
                  className={cn(
                    "rounded-xl border bg-surface p-3.5 shadow-soft",
                    isSel ? "border-accent/60" : "border-line",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={ver.author?.name ?? "System"} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {ver.author?.name ?? "System"}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-faint">
                        <Clock className="h-3 w-3" />
                        {fmt(ver.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Link
                      href={isSel && !againstCurrent ? `/s/${slug}/p/${pageId}/history` : href(ver.id, "prev")}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                        isSel && !againstCurrent
                          ? "border-accent/50 bg-accent-soft text-accent"
                          : "border-line-strong text-muted hover:bg-subtle hover:text-ink",
                      )}
                    >
                      <GitCompareArrows className="h-3.5 w-3.5" />
                      Änderungen
                    </Link>
                    <Link
                      href={isSel && againstCurrent ? `/s/${slug}/p/${pageId}/history` : href(ver.id, "current")}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                        isSel && againstCurrent
                          ? "border-accent/50 bg-accent-soft text-accent"
                          : "border-line-strong text-muted hover:bg-subtle hover:text-ink",
                      )}
                    >
                      Vs. aktuell
                    </Link>
                    {canRestore && (
                      <form action={restoreVersionAction} className="ml-auto">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="versionId" value={ver.id} />
                        <button className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-subtle hover:text-ink">
                          <RotateCcw className="h-3.5 w-3.5" />
                          Wiederherstellen
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {diff && stats && (
          <section className="min-w-0 lg:sticky lg:top-8 lg:self-start">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] text-muted">
                <span className="font-medium text-ink">{diff.fromLabel}</span>
                <span className="mx-2 text-faint">→</span>
                <span className="font-medium text-ink">{diff.toLabel}</span>
              </div>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-600">
                  +{stats.added}
                </span>
                <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 font-medium text-red-600">
                  −{stats.removed}
                </span>
                <Link
                  href={`/s/${slug}/p/${pageId}/history`}
                  aria-label="Vergleich schliessen"
                  className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="max-h-[75vh] overflow-y-auto">
              <DiffView lines={diff.lines} />
            </div>
          </section>
        )}
      </div>

      {versions.length === 0 && (
        <p className="mt-10 text-sm text-faint">
          Noch keine gespeicherten Versionen. Sobald jemand schreibt,
          entstehen automatisch Snapshots.
        </p>
      )}
    </div>
  );
}
