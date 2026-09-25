import type { Metadata } from "next";
import Link from "next/link";
import { FileText, SearchX } from "lucide-react";
import { seesEverything } from "@/lib/page-access";
import { searchPages, type PageHit } from "@/lib/page-search";
import { loadSpace } from "@/lib/space-context";
import { normalizeQuery, splitHighlights } from "@/lib/palette";
import { pageTitle } from "@/lib/page-title";
import { relativeTime } from "@/lib/relative-time";
import { collapseCrumbs } from "@/lib/breadcrumbs";

export const metadata: Metadata = {
  title: "Suche",
  description: "Volltextsuche in diesem Space.",
};

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const { slug } = await params;
  const { q, p } = await searchParams;
  const { space, role, user } = await loadSpace(slug);
  // Dieselbe Obergrenze wie die Palette (100 Zeichen).
  const query = normalizeQuery(q);
  const pageSize = 20;
  const pageNum = Math.max(1, Number(p ?? "1") || 1);
  const offset = (pageNum - 1) * pageSize;

  // Dieselbe Abfrage wie die ⌘K-Palette (lib/page-search.ts), nur auf
  // diesen Space beschraenkt und mit laengerem Schnipsel.
  const results: PageHit[] = query
    ? await searchPages({
        userId: user.id,
        spaceIds: [space.id],
        openSpaceIds: seesEverything(role) ? [space.id] : [],
        q: query,
        limit: pageSize,
        offset,
        snippet: "long",
      })
    : [];
  const now = new Date();
  const hasPrev = pageNum > 1;
  const hasNext = results.length === pageSize;
  const pageHref = (n: number) =>
    `/s/${slug}/search?q=${encodeURIComponent(query)}&p=${n}`;

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <h1 className="text-2xl font-semibold tracking-tight">Suche</h1>
      <p className="mt-1 text-sm text-muted">
        Volltextsuche in „{space.name}“.
      </p>

      <form action={`/s/${slug}/search`} className="mt-6">
        <input
          name="q"
          defaultValue={query}
          aria-label="Suchbegriff"
          placeholder="Suchbegriff…"
          autoFocus={!query}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-ink shadow-soft placeholder:text-faint transition-all focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft"
        />
      </form>
      <p className="mt-2 text-[12px] text-faint">
        Findet auch andere Wortformen (Rechnung findet Rechnungen) und
        Wortanfänge. „Wörter in Anführungszeichen“ suchen genau diese Folge,
        oder verbindet Alternativen, ein Minus davor schliesst ein Wort aus.
        Unter drei Zeichen werden Titelanfänge gesucht, bei zwei Zeichen auch
        genau dieses Wort (etwa KI).
      </p>
      {query && pageNum > 1 && (
        <p className="mt-3 text-[13px] text-faint">Seite {pageNum}</p>
      )}

      <ul className="mt-8 space-y-2">
        {results.map((r) => (
          <li key={r.id}>
            <Link
              href={`/s/${slug}/p/${r.id}`}
              className="group flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-soft transition-all duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-faint group-hover:text-accent" />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium tracking-tight">
                  <span className="truncate">{pageTitle(r.title)}</span>
                  {r.isTemplate && (
                    <span className="shrink-0 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      Vorlage
                    </span>
                  )}
                </p>
                <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-faint">
                  {collapseCrumbs(
                    [space.name, ...r.path.map((a) => pageTitle(a.title))],
                    4,
                  ).map((slot, j) => (
                    <span key={j} className="flex min-w-0 items-center gap-1">
                      {j > 0 && <span className="shrink-0">›</span>}
                      {slot.kind === "item" ? (
                        <span className="truncate">{slot.item}</span>
                      ) : (
                        <span
                          className="shrink-0"
                          title={slot.hidden.join(" › ")}
                        >
                          …
                        </span>
                      )}
                    </span>
                  ))}
                  <span className="shrink-0">
                    · Geändert {relativeTime(r.updatedAt, now)}
                  </span>
                </p>
                {r.snippet && (
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
                    {splitHighlights(r.snippet).map((seg, j) =>
                      seg.hit ? (
                        <mark
                          key={j}
                          className="rounded-sm bg-accent-soft px-0.5 text-accent"
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={j}>{seg.text}</span>
                      ),
                    )}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {query && (hasPrev || hasNext) && (
        <div className="mt-6 flex items-center justify-between">
          {hasPrev ? (
            <Link
              href={pageHref(pageNum - 1)}
              className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-muted hover:bg-subtle hover:text-ink"
            >
              ← Zurück
            </Link>
          ) : (
            <span />
          )}
          {hasNext && (
            <Link
              href={pageHref(pageNum + 1)}
              className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-muted hover:bg-subtle hover:text-ink"
            >
              Weiter →
            </Link>
          )}
        </div>
      )}

      {query && results.length === 0 && (
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-subtle">
            <SearchX className="h-5 w-5 text-faint" />
          </div>
          <p className="mt-4 font-medium">Nichts gefunden</p>
          <p className="mt-1 text-sm text-muted">
            Versuch es mit anderen Begriffen.
          </p>
        </div>
      )}
    </div>
  );
}
