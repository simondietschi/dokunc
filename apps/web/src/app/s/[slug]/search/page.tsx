import Link from "next/link";
import { FileText, SearchX } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";

type Row = { id: string; title: string; snippet: string };

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const { q } = await searchParams;
  const { space } = await loadSpace(slug);
  const query = (q ?? "").trim();

  let results: Row[] = [];
  if (query) {
    results = await prisma.$queryRaw<Row[]>`
      SELECT id, title,
        ts_headline('simple', "textContent",
          plainto_tsquery('simple', ${query}),
          'MaxFragments=1,MaxWords=24,MinWords=6') AS snippet
      FROM "Page"
      WHERE "spaceId" = ${space.id}
        AND "deletedAt" IS NULL
        AND to_tsvector('simple', coalesce(title,'') || ' ' || coalesce("textContent",''))
            @@ plainto_tsquery('simple', ${query})
      ORDER BY ts_rank(
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce("textContent",'')),
        plainto_tsquery('simple', ${query})
      ) DESC
      LIMIT 30
    `;
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <h1 className="text-2xl font-semibold tracking-tight">Suche</h1>
      <p className="mt-1 text-sm text-muted">
        {query ? (
          <>
            {results.length} Treffer für{" "}
            <span className="font-medium text-ink">„{query}"</span>
          </>
        ) : (
          "Gib oben einen Suchbegriff ein."
        )}
      </p>

      <ul className="mt-8 space-y-2">
        {results.map((r) => (
          <li key={r.id}>
            <Link
              href={`/s/${slug}/p/${r.id}`}
              className="group flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-soft transition-all duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-faint group-hover:text-accent" />
              <div className="min-w-0">
                <p className="font-medium tracking-tight">{r.title}</p>
                {r.snippet && (
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
                    {r.snippet}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>

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
