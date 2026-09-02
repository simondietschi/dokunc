"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { insertAt, positionUpdates } from "@/lib/page-move";

export type MoveResult = { ok: true } | { ok: false; error: string };

/**
 * Verschiebt eine Seite (samt Unterbaum) unter eine andere Elternseite
 * bzw. an eine neue Position unter ihren Geschwistern.
 *
 * Felder: slug, pageId, parentId ("" = oberste Ebene), index (optional,
 * Zielposition in der Geschwisterliste ohne die verschobene Seite; ohne
 * Angabe ans Ende).
 *
 * Fehler werden als Ergebnis zurueckgegeben (kein throw), damit Baum und
 * Dialog sie dem Nutzer sauber anzeigen koennen.
 */
export async function movePageAction(form: FormData): Promise<MoveResult> {
  const { space } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");
  const parentId = strOrNull(form, "parentId");
  const indexRaw = str(form, "index");
  const index = indexRaw === "" ? undefined : Number(indexRaw);
  if (index !== undefined && !Number.isInteger(index)) {
    return { ok: false, error: "Ungueltige Zielposition" };
  }

  const result = await prisma.$transaction(async (tx): Promise<MoveResult> => {
    // Nur Seiten dieses Space, nicht im Papierkorb, keine Vorlage.
    const page = await tx.page.findFirst({
      where: {
        id: pageId,
        spaceId: space.id,
        deletedAt: null,
        isTemplate: false,
      },
      select: { id: true, parentId: true },
    });
    if (!page) return { ok: false, error: "Seite nicht gefunden" };

    if (parentId !== null) {
      if (parentId === page.id) {
        return {
          ok: false,
          error: "Eine Seite kann nicht unter sich selbst verschoben werden",
        };
      }
      const parent = await tx.page.findFirst({
        where: {
          id: parentId,
          spaceId: space.id,
          deletedAt: null,
          isTemplate: false,
        },
        select: { id: true },
      });
      if (!parent) return { ok: false, error: "Zielseite nicht gefunden" };

      // Zyklus-Check: die Zielseite darf kein Nachfahre der Seite sein.
      const cyclic = await tx.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE sub AS (
          SELECT id FROM "Page" WHERE id = ${page.id} AND "spaceId" = ${space.id}
          UNION ALL
          SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
          WHERE p."spaceId" = ${space.id}
        )
        SELECT id FROM sub WHERE id = ${parentId} LIMIT 1
      `;
      if (cyclic.length > 0) {
        return {
          ok: false,
          error:
            "Eine Seite kann nicht unter eine ihrer eigenen Unterseiten verschoben werden",
        };
      }
    }

    const siblingWhere = {
      spaceId: space.id,
      deletedAt: null,
      isTemplate: false,
      NOT: { id: page.id },
    };
    const orderBy = [{ position: "asc" as const }, { title: "asc" as const }];

    // Geschwister am Ziel (ohne die Seite selbst) kompakt nummerieren,
    // die Seite an der gewuenschten Stelle einreihen.
    const targetSiblings = await tx.page.findMany({
      where: { ...siblingWhere, parentId },
      orderBy,
      select: { id: true, position: true },
    });
    const current = new Map(targetSiblings.map((s) => [s.id, s.position]));
    const ordered = insertAt(
      targetSiblings.map((s) => s.id),
      page.id,
      index,
    );
    const updates = positionUpdates(ordered, current);

    // Die eigene Position der Seite immer setzen (Elternwechsel).
    const own = updates.find((u) => u.id === page.id);
    await tx.page.updateMany({
      where: { id: page.id, spaceId: space.id },
      data: {
        parentId,
        position: own?.position ?? ordered.indexOf(page.id),
      },
    });
    for (const u of updates) {
      if (u.id === page.id) continue;
      await tx.page.updateMany({
        where: { id: u.id, spaceId: space.id },
        data: { position: u.position },
      });
    }

    // Alte Geschwister ebenfalls kompakt nummerieren (Luecke schliessen).
    if (page.parentId !== parentId) {
      const oldSiblings = await tx.page.findMany({
        where: { ...siblingWhere, parentId: page.parentId },
        orderBy,
        select: { id: true, position: true },
      });
      const oldUpdates = positionUpdates(
        oldSiblings.map((s) => s.id),
        new Map(oldSiblings.map((s) => [s.id, s.position])),
      );
      for (const u of oldUpdates) {
        await tx.page.updateMany({
          where: { id: u.id, spaceId: space.id },
          data: { position: u.position },
        });
      }
    }

    return { ok: true };
  });

  if (result.ok) revalidatePath(`/s/${space.slug}`, "layout");
  return result;
}
