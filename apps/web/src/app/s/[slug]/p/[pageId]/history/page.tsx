import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { restoreVersionAction } from "../../../actions";

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}) {
  const { slug, pageId } = await params;
  const { space, role } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id },
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
    <div className="mx-auto max-w-3xl px-10 py-8">
      <Link
        href={`/s/${slug}/p/${pageId}`}
        className="text-sm text-slate-400"
      >
        ← Zurück zur Seite
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold">
        Verlauf: {page.title}
      </h1>

      <ul className="space-y-2">
        {versions.map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between rounded-lg border bg-white px-4 py-3"
          >
            <div>
              <p className="font-medium">{v.title}</p>
              <p className="text-xs text-slate-400">
                {v.createdAt.toLocaleString("de-DE")}
                {v.author && ` · ${v.author.name}`}
              </p>
            </div>
            {canRestore && (
              <form action={restoreVersionAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="versionId" value={v.id} />
                <button className="text-sm text-slate-600 underline">
                  Wiederherstellen
                </button>
              </form>
            )}
          </li>
        ))}
        {versions.length === 0 && (
          <p className="text-sm text-slate-400">
            Noch keine gespeicherten Versionen.
          </p>
        )}
      </ul>
    </div>
  );
}
