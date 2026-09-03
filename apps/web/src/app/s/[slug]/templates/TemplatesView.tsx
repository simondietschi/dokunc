import Link from "next/link";
import {
  CopyPlus,
  FilePlus2,
  LayoutTemplate,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { BUILTIN_TEMPLATES } from "@/lib/builtin-templates";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import {
  createFromTemplateAction,
  createTemplateAction,
  deleteTemplateAction,
  importBuiltinTemplateAction,
} from "../template-actions";

export type TemplateRow = {
  id: string;
  title: string;
  updatedAt: Date;
  lastEditedBy: { name: string } | null;
};

/** Darstellung der Vorlagen-Verwaltung (Daten kommen aus page.tsx). */
export function TemplatesView({
  slug,
  spaceName,
  templates,
}: {
  slug: string;
  spaceName: string;
  templates: TemplateRow[];
}) {
  const secondaryLink =
    "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-subtle";

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutTemplate className="h-5 w-5 text-muted" />
            Vorlagen
          </h1>
          <p className="mt-1 text-sm text-muted">
            Wiederverwendbare Seitenstrukturen für „{spaceName}“. Vorlagen
            werden im selben Editor bearbeitet, erscheinen aber nicht im
            Seitenbaum.
          </p>
        </div>
        <form action={createTemplateAction}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" size="sm">
            <Plus className="h-3.5 w-3.5" />
            Neue Vorlage
          </Button>
        </form>
      </div>

      <h2 className="mt-10 text-sm font-semibold text-muted">
        Vorlagen dieses Space ({templates.length})
      </h2>

      {templates.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-accent/25 bg-accent-soft">
            <LayoutTemplate className="h-5 w-5 text-accent" />
          </div>
          <p className="mt-4 font-medium">Noch keine eigenen Vorlagen</p>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
            Lege eine neue Vorlage an, speichere eine bestehende Seite über
            ihr Menü als Vorlage oder kopiere eine Standardvorlage in diesen
            Space.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-soft"
            >
              <div className="min-w-[240px] flex-1">
                <p className="truncate text-sm font-medium">
                  {t.title || "Ohne Titel"}
                </p>
                <p className="text-xs text-faint">
                  Zuletzt geändert am{" "}
                  {t.updatedAt.toLocaleString("de-CH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {t.lastEditedBy ? ` von ${t.lastEditedBy.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <form action={createFromTemplateAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="templateId" value={t.id} />
                  <Button variant="secondary" size="sm" type="submit">
                    <FilePlus2 className="h-3.5 w-3.5" />
                    Seite daraus erstellen
                  </Button>
                </form>
                <Link href={`/s/${slug}/p/${t.id}`} className={secondaryLink}>
                  <Pencil className="h-3.5 w-3.5" />
                  Bearbeiten
                </Link>
                <form action={deleteTemplateAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="pageId" value={t.id} />
                  <ConfirmButton
                    message={`Vorlage „${t.title || "Ohne Titel"}“ in den Papierkorb verschieben?`}
                    title="Vorlage löschen"
                    className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 flex items-center gap-1.5 text-sm font-semibold text-muted">
        <Sparkles className="h-3.5 w-3.5" />
        Standardvorlagen
      </h2>
      <p className="mt-1 text-[13px] text-faint">
        Mitgelieferte Vorlagen. Als Kopie in diesem Space lassen sie sich
        an dein Team anpassen.
      </p>
      <ul className="mt-3 space-y-2">
        {BUILTIN_TEMPLATES.map((t) => (
          <li
            key={t.key}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-soft"
          >
            <div className="min-w-[240px] flex-1">
              <p className="truncate text-sm font-medium">{t.title}</p>
              <p className="text-xs text-faint">{t.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <form action={createFromTemplateAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="builtin" value={t.key} />
                <Button variant="secondary" size="sm" type="submit">
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Seite daraus erstellen
                </Button>
              </form>
              <form action={importBuiltinTemplateAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="builtin" value={t.key} />
                <Button variant="ghost" size="sm" type="submit">
                  <CopyPlus className="h-3.5 w-3.5" />
                  Als Vorlage in diesen Space kopieren
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
