import Link from "next/link";
import { FileText, SearchX } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { HL_START, HL_STOP, splitHighlights } from "@/lib/palette";

type Row = { id: string; title: string; snippet: string; isTemplate: boolean };

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const { slug } = await params;
  const { q, p } = await searchParams;
  const { space } = await loadSpace(slug);
  const query = (q ?? "").trim();
  const pageSize = 20;
  const pageNum = Math.max(1, Number(p ?? "1") || 1);
  const offset = (pageNum - 1) * pageSize;

  let results: Row[] = [];
  if (query) {
    results = await prisma.$queryRaw<Row[]>`
      SELECT id, title, "isTemplate",
        ts_headline('simple', "textContent",
          plainto_tsquery('simple', ${query}),
          ${`StartSel=${HL_START},StopSel=${HL_STOP},MaxFragments=1,MaxWords=24,MinWords=6`}) AS snippet
      FROM "Page"
      WHERE "spaceId" = ${space.id}
        AND "deletedAt" IS NULL
        AND to_tsvector('simple', coalesce(title,'') || ' ' || coalesce("textContent",''))
            @@ plainto_tsquery('simple', ${query})
      ORDER BY ts_rank(
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce("textContent",'')),
        plainto_tsquery('simple', ${query})
      ) DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
  }
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
          placeholder="Suchbegriff…"
          autoFocus={!query}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-ink shadow-soft placeholder:text-faint transition-all focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft"
        />
      </form>
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
                  <span className="truncate">{r.title}</span>
                  {r.isTemplate && (
                    <span className="shrink-0 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      Vorlage
                    </span>
                  )}
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
