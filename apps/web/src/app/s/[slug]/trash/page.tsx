import { redirect } from "next/navigation";
import { Trash2, RotateCcw } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { restorePageAction, purgePageAction } from "../actions";

export default async function TrashPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role } = await loadSpace(slug);
  if (!can(role, "managePages")) redirect(`/s/${slug}`);

  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, NOT: { deletedAt: null } },
    orderBy: { deletedAt: "desc" },
    select: { id: true, title: true, deletedAt: true, isTemplate: true },
  });

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Trash2 className="h-5 w-5 text-muted" />
        Papierkorb
      </h1>
      <p className="mt-1 text-sm text-muted">
        Gelöschte Seiten in „{space.name}". Wiederherstellen stellt auch
        Unterseiten wieder her.
      </p>

      <ul className="mt-8 space-y-2">
        {pages.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-3.5 shadow-soft"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{p.title || "Ohne Titel"}</span>
                {p.isTemplate && (
                  <span className="shrink-0 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                    Vorlage
                  </span>
                )}
              </p>
              <p className="text-xs text-faint">
                gelöscht am{" "}
                {p.deletedAt?.toLocaleString("de-DE", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <form action={restorePageAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="pageId" value={p.id} />
                <Button variant="secondary" size="sm" type="submit">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Wiederherstellen
                </Button>
              </form>
              <form action={purgePageAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="pageId" value={p.id} />
                <ConfirmButton
                  message={`„${p.title}" endgültig löschen? Das kann nicht rückgängig gemacht werden.`}
                  title="Endgültig löschen"
                  className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </ConfirmButton>
              </form>
            </div>
          </li>
        ))}
      </ul>

      {pages.length === 0 && (
        <p className="mt-10 text-sm text-faint">Papierkorb ist leer.</p>
      )}
    </div>
  );
}
