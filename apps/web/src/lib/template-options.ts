import { BUILTIN_TEMPLATES } from "@/lib/builtin-templates";
import { previewLines } from "@/lib/page-text";

/** Vorlage dieses Space, wie sie der Picker in der Sidebar bekommt. */
export type SpaceTemplateOption = {
  id: string;
  title: string;
  /** ISO-Zeitstempel (serialisierbar für Client-Komponenten). */
  updatedAt: string;
  preview: string[];
};

/** Mitgelieferte Standardvorlage (nur Metadaten + Vorschau, kein JSON). */
export type BuiltinTemplateOption = {
  key: string;
  title: string;
  description: string;
  preview: string[];
};

export type TemplateOptions = {
  space: SpaceTemplateOption[];
  builtin: BuiltinTemplateOption[];
};

export const PREVIEW_LINES = 10;

/** Vorschau-Daten der Standardvorlagen (ohne den vollen Inhalt). */
export function builtinTemplateOptions(): BuiltinTemplateOption[] {
  return BUILTIN_TEMPLATES.map((t) => ({
    key: t.key,
    title: t.title,
    description: t.description,
    preview: previewLines(t.content, PREVIEW_LINES),
  }));
}

/** Vorschau-Daten für Vorlagen des Space aus den DB-Zeilen. */
export function spaceTemplateOptions(
  rows: { id: string; title: string; updatedAt: Date; content: unknown }[],
): SpaceTemplateOption[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
    preview: previewLines(r.content, PREVIEW_LINES),
  }));
}
