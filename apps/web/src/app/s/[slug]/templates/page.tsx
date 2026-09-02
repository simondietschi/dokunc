import { redirect } from "next/navigation";
import { LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { BUILTIN_TEMPLATE_META } from "@/lib/templates";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { createPageAction, deleteTemplateAction } from "../actions";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role } = await loadSpace(slug);
  if (!can(role, "managePages")) redirect(`/s/${slug}`);

  const templates = await prisma.pageTemplate.findMany({
    where: { spaceId: space.id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      icon: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <LayoutTemplate className="h-5 w-5 text-muted" />
        Vorlagen
      </h1>
      <p className="mt-1 text-sm text-muted">
        Startinhalte für neue Seiten in „{space.name}“. Eigene Vorlagen
        legst du auf einer Seite über das Menü „⋯ → Als Vorlage speichern“
        an.
      </p>

      <h2 className="mt-8 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Eigene Vorlagen
      </h2>
      {templates.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-line-strong p-5 text-center text-sm text-faint">
          Noch keine eigenen Vorlagen.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-3.5 shadow-soft"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-canvas text-[20px] leading-none">
                  {t.icon ?? <LayoutTemplate className="h-4 w-4 text-muted" />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="truncate text-xs text-faint">
                    {t.description ??
                      `erstellt ${t.createdAt.toLocaleDateString("de-CH")}${
                        t.createdBy ? ` von ${t.createdBy.name}` : ""
                      }`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <form action={createPageAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="templateId" value={t.id} />
                  <Button variant="secondary" size="sm" type="submit">
                    <Plus className="h-3.5 w-3.5" />
                    Seite anlegen
                  </Button>
                </form>
                <form action={deleteTemplateAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="templateId" value={t.id} />
                  <ConfirmButton
                    message={`Vorlage „${t.name}“ löschen?`}
                    title="Vorlage löschen"
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-[11px] font-semibold uppercase tracking-wider text-faint">
        Eingebaute Vorlagen
      </h2>
      <ul className="mt-2 space-y-2">
        {BUILTIN_TEMPLATE_META.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-3.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-canvas text-[20px] leading-none">
                {t.icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="truncate text-xs text-faint">{t.description}</p>
              </div>
            </div>
            <form action={createPageAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="templateId" value={t.id} />
              <Button variant="secondary" size="sm" type="submit">
                <Plus className="h-3.5 w-3.5" />
                Seite anlegen
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
