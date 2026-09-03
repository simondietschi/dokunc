import Link from "next/link";
import { Clock, FileText, Pencil, Plus, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PaletteButton } from "@/components/CommandPalette";
import { createPageAction } from "@/app/s/[slug]/actions";
import { relativeTime } from "@/lib/relative-time";

export type DashboardEntry = {
  id: string;
  title: string;
  /** Sekundaerzeile, z. B. "vor 5 Min." oder "Anna · gestern". */
  meta: string;
};

type Props = {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  pageCount: number;
  memberCount: number;
  canCreate: boolean;
  recent: DashboardEntry[];
  favorites: DashboardEntry[];
  changed: DashboardEntry[];
};

function stagger(i: number): React.CSSProperties {
  return {
    animation: "rise 0.45s cubic-bezier(0.22,1,0.36,1) both",
    animationDelay: `${40 + i * 60}ms`,
  };
}

/**
 * Startseite eines Space: Kopf mit Kennzahlen und Aktionen, darunter
 * die persoenlichen Einstiege (Zuletzt besucht, Favoriten) und die
 * juengsten Aenderungen im Team. Reine Darstellung — Daten kommen aus
 * der Route.
 */
export function SpaceDashboard({
  slug,
  name,
  description,
  icon,
  pageCount,
  memberCount,
  canCreate,
  recent,
  favorites,
  changed,
}: Props) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 md:px-8 md:py-14">
      <header
        className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"
        style={stagger(0)}
      >
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-violet-500 text-2xl font-bold text-white shadow-soft">
            {icon || name[0]?.toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight md:text-3xl">
              {name}
            </h1>
            {description && (
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
                {description}
              </p>
            )}
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-faint" />
                {pageCount} {pageCount === 1 ? "Seite" : "Seiten"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-faint" />
                {memberCount} {memberCount === 1 ? "Mitglied" : "Mitglieder"}
              </span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <PaletteButton variant="chip" />
          {canCreate && (
            <form action={createPageAction}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" size="sm">
                <Plus className="h-4 w-4" />
                Neue Seite
              </Button>
            </form>
          )}
        </div>
      </header>

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <Section
          title="Zuletzt besucht"
          icon={<Clock className="h-3.5 w-3.5" />}
          slug={slug}
          entries={recent}
          empty="Seiten, die du oeffnest, erscheinen hier."
          style={stagger(1)}
        />
        <Section
          title="Favoriten"
          icon={<Star className="h-3.5 w-3.5" />}
          slug={slug}
          entries={favorites}
          empty="Markiere Seiten mit dem Stern, um sie hier zu sammeln."
          style={stagger(2)}
        />
        <Section
          title="Zuletzt geaendert"
          icon={<Pencil className="h-3.5 w-3.5" />}
          slug={slug}
          entries={changed}
          empty="Noch keine Aenderungen."
          style={stagger(3)}
        />
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  slug,
  entries,
  empty,
  style,
}: {
  title: string;
  icon: React.ReactNode;
  slug: string;
  entries: DashboardEntry[];
  empty: string;
  style?: React.CSSProperties;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col rounded-xl border border-line bg-surface shadow-soft"
      style={style}
    >
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-semibold text-muted">
        <span className="text-faint">{icon}</span>
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-[13px] leading-relaxed text-faint">
          {empty}
        </p>
      ) : (
        <ul className="p-1.5">
          {entries.map((e) => (
            <li key={e.id}>
              <Link
                href={`/s/${slug}/p/${e.id}`}
                className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-subtle"
              >
                <FileText className="h-4 w-4 shrink-0 text-faint transition-colors group-hover:text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {e.title || "Untitled"}
                  </span>
                  <span className="block truncate text-[12px] text-faint">
                    {e.meta}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Sekundaerzeile fuer "Zuletzt geaendert": Person und Zeitpunkt. */
export function changedMeta(
  editorName: string | null | undefined,
  updatedAt: Date,
  now = new Date(),
): string {
  const when = relativeTime(updatedAt, now);
  return editorName ? `${editorName} · ${when}` : when;
}
