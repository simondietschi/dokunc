import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, RotateCcw, Clock, GitCompare } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { visiblePageWhere } from "@/lib/page-access";
import { contentToHtml } from "@/lib/page-html";
import { Avatar } from "@/components/ui/Avatar";
import { restoreVersionAction } from "../../../actions";
import { VersionDiff } from "./VersionDiff";

export const metadata: Metadata = {
  title: "Versionsverlauf",
  description: "Frühere Fassungen dieser Seite.",
};

/** Fassungen pro Seite. Vorher wurde die gesamte Historie geladen. */
const PAGE_SIZE = 25;

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; pageId: string }>;
  searchParams: Promise<{ v?: string; against?: string; limit?: string }>;
}) {
  const { slug, pageId } = await params;
  const { v, against, limit } = await searchParams;
  const { space, role, user } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      spaceId: space.id,
      deletedAt: null,
      ...visiblePageWhere(user.id, role),
    },
    select: { id: true, title: true, content: true, textContent: true },
  });
  if (!page) notFound();

  const take = Math.min(
    Math.max(Number(limit) || PAGE_SIZE, PAGE_SIZE),
    200,
  );
  const [versions, total] = await Promise.all([
    prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
      take,
    }),
    prisma.pageVersion.count({ where: { pageId } }),
  ]);
  const canRestore = can(role, "write");

  // Ausgewählte Fassung und Vergleichspartner — beide auf diese Seite
  // eingegrenzt, die IDs kommen aus der Adresszeile.
  const selected = v ? versions.find((x) => x.id === v) : undefined;
  const other = against ? versions.find((x) => x.id === against) : undefined;

  const label = (date: Date) =>
    date.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-3xl px-8 py-14 animate-[rise_0.4s_ease]">
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
      <p className="mt-1 text-sm text-muted">
        {page.title} · {total}{" "}
        {total === 1 ? "Fassung" : "Fassungen"}
      </p>

      {selected && (
        <div className="mt-8 space-y-4">
          <VersionDiff
            before={selected.textContent}
            after={other ? other.textContent : page.textContent}
            beforeLabel={label(selected.createdAt)}
            afterLabel={other ? label(other.createdAt) : "aktuelle Fassung"}
          />

          <section className="rounded-xl border border-line bg-surface p-5 shadow-soft">
            <h2 className="text-sm font-semibold">
              Vorschau vom {label(selected.createdAt)}
            </h2>
            <div
              className="dk-version-preview mt-3"
              // Aus dem eigenen Editor-Schema erzeugt: generateHTML gibt
              // nur aus, was das Schema kennt.
              dangerouslySetInnerHTML={{
                __html: contentToHtml(selected.content),
              }}
            />
            {canRestore && (
              <form action={restoreVersionAction} className="mt-4">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="versionId" value={selected.id} />
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-subtle hover:text-ink">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Diese Fassung wiederherstellen
                </button>
              </form>
            )}
          </section>
        </div>
      )}

      <ol className="mt-8 space-y-1 border-l border-line pl-6">
        {versions.map((x) => {
          const isSelected = x.id === selected?.id;
          const isOther = x.id === other?.id;
          return (
            <li key={x.id} className="relative pb-6">
              <span className="absolute -left-[1.7rem] top-1 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-canvas bg-accent" />
              <div
                className={`flex items-center justify-between gap-4 rounded-xl border bg-surface p-4 shadow-soft ${
                  isSelected || isOther ? "border-accent" : "border-line"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={x.author?.name ?? "System"} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {x.author?.name ?? "System"}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-faint">
                      <Clock className="h-3 w-3" />
                      <time dateTime={x.createdAt.toISOString()}>
                        {label(x.createdAt)}
                      </time>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Link
                    href={`?v=${x.id}`}
                    className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                      isSelected
                        ? "border-accent text-accent"
                        : "border-line-strong text-muted hover:bg-subtle hover:text-ink"
                    }`}
                  >
                    Ansehen
                  </Link>
                  {selected && !isSelected && (
                    <Link
                      href={`?v=${selected.id}&against=${x.id}`}
                      title="Mit der ausgewählten Fassung vergleichen"
                      className={`grid h-[30px] w-[30px] place-items-center rounded-lg border transition-colors ${
                        isOther
                          ? "border-accent text-accent"
                          : "border-line-strong text-muted hover:bg-subtle hover:text-ink"
                      }`}
                    >
                      <GitCompare className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {total > versions.length && (
        <Link
          href={`?limit=${Math.min(take + PAGE_SIZE, 200)}${
            v ? `&v=${v}` : ""
          }${against ? `&against=${against}` : ""}`}
          className="mt-2 inline-block rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          Weitere Fassungen laden
        </Link>
      )}

      {versions.length === 0 && (
        <p className="mt-10 text-sm text-faint">
          Noch keine gespeicherten Versionen. Sobald jemand schreibt,
          entstehen automatisch Snapshots.
        </p>
      )}
    </div>
  );
}
