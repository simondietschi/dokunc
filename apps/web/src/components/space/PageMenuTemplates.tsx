"use client";

import { useState } from "react";
import { Copy, FilePlus2, LayoutTemplate } from "lucide-react";
import { MenuItem } from "@/components/space/PageActions";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { schutzwechselToken } from "@/lib/confirmation";
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
 *
 * Eine Vorlage ist für den ganzen Space offen. Aus einer geschützten
 * Seite legt sie deshalb nur die Space-Verwaltung an, nach einer
 * Rückfrage; alle anderen sehen statt des Eintrags einen Hinweis. Der
 * Server prüft dasselbe (saveAsTemplateAction).
 */
export function PageMenuTemplates({
  slug,
  pageId,
  isTemplate,
  hasChildren,
  protectedRootId = null,
  canAdminister = false,
}: {
  slug: string;
  pageId: string;
  isTemplate: boolean;
  hasChildren: boolean;
  /** Wirksame Schutzwurzel der Seite, null = offen. */
  protectedRootId?: string | null;
  /** Ab ADMIN: darf eine geschützte Seite als Vorlage freigeben. */
  canAdminister?: boolean;
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
      {!protectedRootId ? (
        <form action={saveAsTemplateAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pageId" value={pageId} />
          <MenuItem type="submit" icon={<LayoutTemplate className="h-4 w-4" />}>
            Als Vorlage speichern
          </MenuItem>
        </form>
      ) : canAdminister ? (
        <form action={saveAsTemplateAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="pageId" value={pageId} />
          <input
            type="hidden"
            name="confirmProtection"
            value={schutzwechselToken(protectedRootId, null)}
          />
          <ConfirmButton
            title="Vorlage aus geschützter Seite"
            message={
              "Diese Seite ist geschützt. Die Vorlage ist für alle im Space " +
              "sichtbar, die Vorlagen nutzen. Der Vorgang wird protokolliert."
            }
            confirmLabel="Vorlage speichern"
            destructive={false}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <LayoutTemplate className="h-4 w-4" />
            Als Vorlage speichern…
          </ConfirmButton>
        </form>
      ) : (
        <p className="px-2.5 py-2 text-[12px] text-faint">
          Geschützte Seiten kann nur die Space-Verwaltung als Vorlage speichern.
        </p>
      )}
      <div className="my-1 border-t border-line" />
    </>
  );
}
