import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, RotateCcw, Clock, GitCompareArrows } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { Avatar } from "@/components/ui/Avatar";
import { restoreVersionAction } from "../../../actions";

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}) {
  const { slug, pageId } = await params;
  const { space, role } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!page) notFound();

  const versions = await prisma.pageVersion.findMany({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true } } },
  });
  const canRestore = can(role, "write");

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
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

      <ol className="mt-8 space-y-1 border-l border-line pl-6">
        {versions.map((v, i) => (
          <li key={v.id} className="relative pb-6">
            <span className="absolute -left-[1.7rem] top-1 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-canvas bg-accent" />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-soft">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={v.author?.name ?? "System"} size={32} />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {v.author?.name ?? "System"}
                    {i === 0 && (
                      <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                        Aktueller Stand
                      </span>
                    )}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-faint">
                    <Clock className="h-3 w-3" />
                    {v.createdAt.toLocaleString("de-DE", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/s/${slug}/p/${pageId}/history/${v.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-subtle hover:text-ink"
                >
                  <GitCompareArrows className="h-3.5 w-3.5" />
                  Vergleichen
                </Link>
                {canRestore && (
                  <form action={restoreVersionAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="versionId" value={v.id} />
                    <button className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-subtle hover:text-ink">
                      <RotateCcw className="h-3.5 w-3.5" />
                      Wiederherstellen
                    </button>
                  </form>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {versions.length === 0 && (
        <p className="mt-10 text-sm text-faint">
          Noch keine gespeicherten Versionen. Sobald jemand schreibt,
          entstehen automatisch Snapshots.
        </p>
      )}
    </div>
  );
}
