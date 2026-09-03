import { FileText, Plus, Slash, Link2, AtSign } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { relativeTime } from "@/lib/relative-time";
import { Button } from "@/components/ui/Button";
import { SpaceDashboard, changedMeta } from "@/components/space/SpaceDashboard";
import { createPageAction } from "./actions";

const TIPS = [
  { icon: Slash, kbd: "/", text: "Befehle & Blöcke" },
  { icon: Link2, kbd: "[[", text: "Wiki-Links" },
  { icon: AtSign, kbd: "@", text: "Personen erwähnen" },
];

function stagger(i: number): React.CSSProperties {
  return {
    animation: "rise 0.5s cubic-bezier(0.22,1,0.36,1) both",
    animationDelay: `${60 + i * 80}ms`,
  };
}

/** Sichtbare Seiten des Space: nicht geloescht, keine Vorlagen. */
const visiblePages = (spaceId: string) =>
  ({ spaceId, deletedAt: null, isTemplate: false }) as const;

export default async function SpaceIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role, user } = await loadSpace(slug);
  const canCreate = can(role, "managePages");

  const pageCount = await prisma.page.count({
    where: visiblePages(space.id),
  });

  if (pageCount === 0) {
    return (
      <EmptySpace name={space.name} slug={space.slug} canCreate={canCreate} />
    );
  }

  const [memberCount, visits, favorites, changed] = await Promise.all([
    prisma.spaceMember.count({ where: { spaceId: space.id } }),
    prisma.pageVisit.findMany({
      where: { userId: user.id, page: visiblePages(space.id) },
      orderBy: { visitedAt: "desc" },
      take: 8,
      select: { visitedAt: true, page: { select: { id: true, title: true } } },
    }),
    prisma.favorite.findMany({
      where: { userId: user.id, page: visiblePages(space.id) },
      orderBy: { createdAt: "asc" },
      take: 8,
      select: {
        page: { select: { id: true, title: true, updatedAt: true } },
      },
    }),
    prisma.page.findMany({
      where: visiblePages(space.id),
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        lastEditedBy: { select: { name: true } },
      },
    }),
  ]);

  const now = new Date();

  return (
    <SpaceDashboard
      slug={space.slug}
      name={space.name}
      description={space.description}
      icon={space.icon}
      pageCount={pageCount}
      memberCount={memberCount}
      canCreate={canCreate}
      recent={visits.map((v) => ({
        id: v.page.id,
        title: v.page.title,
        meta: relativeTime(v.visitedAt, now),
      }))}
      favorites={favorites.map((f) => ({
        id: f.page.id,
        title: f.page.title,
        meta: `Geändert ${relativeTime(f.page.updatedAt, now)}`,
      }))}
      changed={changed.map((p) => ({
        id: p.id,
        title: p.title,
        meta: changedMeta(p.lastEditedBy?.name, p.updatedAt, now),
      }))}
    />
  );
}

/** Bestehender Empty-State: nur fuer Spaces ohne einzige Seite. */
function EmptySpace({
  name,
  slug,
  canCreate,
}: {
  name: string;
  slug: string;
  canCreate: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-16 text-center">
      <div
        className="grid h-14 w-14 place-items-center rounded-2xl border border-accent/25 bg-accent-soft shadow-soft"
        style={stagger(0)}
      >
        <FileText className="h-6 w-6 text-accent" />
      </div>
      <h2
        className="mt-5 text-xl font-semibold tracking-tight"
        style={stagger(1)}
      >
        „{name}“ ist noch leer
      </h2>
      <p
        className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted"
        style={stagger(2)}
      >
        {canCreate
          ? "Leg die erste Seite an — dein Team schreibt in Echtzeit mit."
          : "Hier gibt es noch keine Seiten. Schau später wieder vorbei."}
      </p>

      {canCreate && (
        <form action={createPageAction} className="mt-6" style={stagger(3)}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" size="lg">
            <Plus className="h-4 w-4" />
            Erste Seite erstellen
          </Button>
        </form>
      )}

      <div
        className="mt-10 flex flex-wrap items-center justify-center gap-2.5"
        style={stagger(4)}
      >
        {TIPS.map(({ icon: Icon, kbd, text }) => (
          <span
            key={kbd}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-muted shadow-soft"
          >
            <Icon className="h-3.5 w-3.5 text-faint" />
            <kbd className="rounded border border-line-strong bg-subtle px-1.5 py-px font-mono text-[11px] text-ink">
              {kbd}
            </kbd>
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
