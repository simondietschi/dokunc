import Link from "next/link";
import { Clock, FileText, Star } from "lucide-react";
import { prisma } from "@dokunc/db";
import { relativeTime } from "@/lib/relative-time";

type Entry = {
  id: string;
  title: string;
  slug: string;
  spaceName: string;
  meta: string;
};

/**
 * Startseite /spaces: persoenliche Einstiege ueber alle Spaces hinweg.
 * Rendert nichts, solange es weder Besuche noch Favoriten gibt.
 * Nur Seiten aus Spaces mit aktueller Mitgliedschaft — ein alter Besuch
 * in einem verlassenen Space darf dessen Titel nicht mehr verraten.
 */
export async function RecentAndFavorites({ userId }: { userId: string }) {
  const pageScope = {
    deletedAt: null,
    isTemplate: false,
    space: { members: { some: { userId } } },
  } as const;
  const pageSelect = {
    id: true,
    title: true,
    space: { select: { slug: true, name: true } },
  } as const;

  const [visits, favorites] = await Promise.all([
    prisma.pageVisit.findMany({
      where: { userId, page: pageScope },
      orderBy: { visitedAt: "desc" },
      take: 6,
      select: { visitedAt: true, page: { select: pageSelect } },
    }),
    prisma.favorite.findMany({
      where: { userId, page: pageScope },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { page: { select: pageSelect } },
    }),
  ]);

  if (visits.length === 0 && favorites.length === 0) return null;

  const now = new Date();
  const recent: Entry[] = visits.map((v) => ({
    id: v.page.id,
    title: v.page.title,
    slug: v.page.space.slug,
    spaceName: v.page.space.name,
    meta: relativeTime(v.visitedAt, now),
  }));
  const starred: Entry[] = favorites.map((f) => ({
    id: f.page.id,
    title: f.page.title,
    slug: f.page.space.slug,
    spaceName: f.page.space.name,
    meta: f.page.space.name,
  }));

  return (
    <div className="mt-12 grid gap-5 md:grid-cols-2 animate-[rise_0.5s_ease_both]">
      {recent.length > 0 && (
        <Section
          title="Zuletzt besucht"
          icon={<Clock className="h-3.5 w-3.5" />}
          entries={recent}
          showSpace
        />
      )}
      {starred.length > 0 && (
        <Section
          title="Favoriten"
          icon={<Star className="h-3.5 w-3.5" />}
          entries={starred}
        />
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  entries,
  showSpace,
}: {
  title: string;
  icon: React.ReactNode;
  entries: Entry[];
  showSpace?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-line bg-surface shadow-soft"
    >
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-semibold text-muted">
        <span className="text-faint">{icon}</span>
        {title}
      </h2>
      <ul className="p-1.5">
        {entries.map((e) => (
          <li key={e.id}>
            <Link
              href={`/s/${e.slug}/p/${e.id}`}
              className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-subtle"
            >
              <FileText className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">
                  {e.title || "Untitled"}
                </span>
                <span className="block truncate text-[12px] text-faint">
                  {showSpace ? `${e.spaceName} · ${e.meta}` : e.meta}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
