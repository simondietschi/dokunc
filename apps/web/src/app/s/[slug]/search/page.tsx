import Link from "next/link";
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
          'MaxFragments=1,MaxWords=20,MinWords=5') AS snippet
      FROM "Page"
      WHERE "spaceId" = ${space.id}
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
    <div className="mx-auto max-w-3xl px-10 py-8">
      <h1 className="mb-1 text-2xl font-bold">Suche</h1>
      <p className="mb-6 text-sm text-slate-400">
        {query ? `Ergebnisse für „${query}"` : "Suchbegriff eingeben."}
      </p>
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.id}>
            <Link
              href={`/s/${slug}/p/${r.id}`}
              className="block rounded-lg border bg-white px-4 py-3 hover:bg-slate-50"
            >
              <p className="font-medium">{r.title}</p>
              {r.snippet && (
                <p className="text-sm text-slate-500">{r.snippet}</p>
              )}
            </Link>
          </li>
        ))}
        {query && results.length === 0 && (
          <p className="text-sm text-slate-400">Nichts gefunden.</p>
        )}
      </ul>
    </div>
  );
}
