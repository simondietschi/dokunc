"use client";

import { useState } from "react";
import { Copy, FilePlus2, LayoutTemplate } from "lucide-react";
import { MenuItem } from "@/components/space/PageActions";
import { Button } from "@/components/ui/Button";
import {
  createFromTemplateAction,
  duplicatePageAction,
  saveAsTemplateAction,
} from "@/app/s/[slug]/template-actions";

/**
 * Menüeinträge für das "…"-Menü der Seitenkopfzeile:
 *  - Vorlage: "Seite aus dieser Vorlage erstellen"
 *  - normale Seite: "Duplizieren" (mit Unterseiten-Option, falls es
 *    welche gibt) und "Als Vorlage speichern"
 */
export function PageMenuTemplates({
  slug,
  pageId,
  isTemplate,
  hasChildren,
}: {
  slug: string;
  pageId: string;
  isTemplate: boolean;
  hasChildren: boolean;
}) {
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  if (isTemplate) {
    return (
      <form action={createFromTemplateAction}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="templateId" value={pageId} />
        <MenuItem type="submit" icon={<FilePlus2 className="h-4 w-4" />}>
          Seite aus dieser Vorlage erstellen
        </MenuItem>
        <div className="my-1 border-t border-line" />
      </form>
    );
  }

  return (
    <>
      {hasChildren ? (
        <>
          <MenuItem
            icon={<Copy className="h-4 w-4" />}
            onClick={() => setDuplicateOpen((o) => !o)}
          >
            Duplizieren
          </MenuItem>
          {duplicateOpen && (
            <form
              action={duplicatePageAction}
              className="mx-1 mb-1 rounded-lg border border-line bg-subtle/60 p-2.5"
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="pageId" value={pageId} />
              <label className="flex items-center gap-2 text-[12.5px] text-muted">
                <input
                  type="checkbox"
                  name="withChildren"
                  value="1"
                  defaultChecked
                  className="h-3.5 w-3.5 accent-accent"
                />
                Unterseiten mitkopieren
              </label>
              <Button type="submit" size="sm" className="mt-2 w-full">
                Kopie erstellen
              </Button>
            </form>
          )}
        </>
      ) : (
        <form action={duplicatePageAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pageId" value={pageId} />
          <MenuItem type="submit" icon={<Copy className="h-4 w-4" />}>
            Duplizieren
          </MenuItem>
        </form>
      )}
      <form action={saveAsTemplateAction}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="pageId" value={pageId} />
        <MenuItem type="submit" icon={<LayoutTemplate className="h-4 w-4" />}>
          Als Vorlage speichern
        </MenuItem>
      </form>
      <div className="my-1 border-t border-line" />
    </>
  );
}
