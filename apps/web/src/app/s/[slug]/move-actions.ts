"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { movePageInSpace, type MoveResult } from "@/lib/page-guards";

/**
 * Verschiebt eine Seite (samt Unterbaum) unter eine andere Elternseite
 * bzw. an eine neue Position unter ihren Geschwistern.
 *
 * Felder: slug, pageId, parentId ("" = oberste Ebene), index (optional,
 * Zielposition in der Geschwisterliste ohne die verschobene Seite; ohne
 * Angabe ans Ende).
 *
 * Hier stehen nur Rolle und Formular: die Regeln des Zugs selbst liegen
 * in movePageInSpace, wo sie ohne Anfragekontext geprueft werden.
 * Fehler werden als Ergebnis zurueckgegeben (kein throw), damit Baum und
 * Dialog sie dem Nutzer sauber anzeigen koennen.
 */
export async function movePageAction(form: FormData): Promise<MoveResult> {
  const { space, user, role } = await authorizeAction(form, "managePages");
  const indexRaw = str(form, "index");
  const result = await movePageInSpace(
    { spaceId: space.id, userId: user.id, role },
    str(form, "pageId"),
    strOrNull(form, "parentId"),
    indexRaw === "" ? undefined : Number(indexRaw),
  );
  if (result.ok) revalidatePath(`/s/${space.slug}`, "layout");
  return result;
}
