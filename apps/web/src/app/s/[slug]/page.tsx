import { redirect } from "next/navigation";
import { FileText, Plus, Slash, Link2, AtSign } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
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

export default async function SpaceIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role } = await loadSpace(slug);

  const first = await prisma.page.findFirst({
    where: { spaceId: space.id, parentId: null, deletedAt: null },
    orderBy: { position: "asc" },
    select: { id: true },
  });

  if (first) redirect(`/s/${slug}/p/${first.id}`);

  const canCreate = can(role, "managePages");

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
        „{space.name}“ ist noch leer
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
          <input type="hidden" name="slug" value={space.slug} />
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
