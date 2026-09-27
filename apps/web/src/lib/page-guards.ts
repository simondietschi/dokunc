import "server-only";
import { prisma, type Prisma, type SpaceRole } from "@dokunc/db";
import {
  refreshAccessRoots,
  seesEverything,
  visiblePageSql,
  visiblePageWhere,
} from "./page-access";
import { insertAt, positionUpdates } from "./page-move";
import { lockSiblingOrder, nextSiblingPosition } from "./page-position";
import { DEFAULT_PAGE_TITLE } from "@/lib/page-title";

/**
 * Bindung von Objekt-IDs an das, was die handelnde Person tatsächlich
 * anfassen darf.
 *
 * `authorizeAction` prüft nur, ob die Person im Space aus dem Feld
 * `slug` etwas darf. Seiten- und Versions-IDs kommen aber aus demselben
 * Formular, also aus Nutzerhand. Ohne zusätzliche Bindung liesse sich
 * mit einem Slug, in dem man schreiben darf, eine ID aus einem fremden
 * Space treffen — oder eine geschützte Seite desselben Space, die man
 * gar nicht sehen darf. Diese Funktionen sind diese Bindung, und der
 * Ort, an dem sie sich testen lässt.
 *
 * Deshalb nehmen sie den ganzen Kontext und nicht bloss eine spaceId:
 * so lässt sich keine der beiden Hälften versehentlich weglassen.
 */
export type PageScope = {
  spaceId: string;
  userId: string;
  role: SpaceRole;
};

/**
 * Der Kontext aus dem Ergebnis von `authorizeAction`. Als eigener
 * Schritt, damit keine Aktion versehentlich nur die Hälfte mitgibt und
 * damit an geschützten Seiten vorbeiliefe.
 */
export function scopeOf(access: {
  space: { id: string };
  user: { id: string };
  role: SpaceRole;
}): PageScope {
  return { spaceId: access.space.id, userId: access.user.id, role: access.role };
}

/**
 * Space-Bindung und Sichtbarkeit in einer Bedingung.
 *
 * Exportiert für die Abfragen, die mehr als eine einzelne Seite treffen
 * (beim Duplizieren der Unterbaum und seine Inhalte): auch sie beziehen
 * die Regel von hier. Jede eigene Fassung war bisher die Stelle, an der
 * der Sichtbarkeitsteil irgendwann fehlte.
 */
export function scopeWhere(scope: PageScope): Prisma.PageWhereInput {
  return {
    spaceId: scope.spaceId,
    ...visiblePageWhere(scope.userId, scope.role),
  };
}

/**
 * Dieselbe Sichtbarkeit als SQL-Baustein für Rohabfragen (Seitentabelle
 * unter dem Alias `p`). Die Space-Bindung gehört dort in die Abfrage
 * selbst; hier steht nur, was die Person sehen darf — für die Verwaltung
 * der ganze Space.
 */
export function scopeVisibleSql(scope: PageScope): Prisma.Sql {
  return visiblePageSql(
    scope.userId,
    seesEverything(scope.role) ? [scope.spaceId] : [],
  );
}

/**
 * Einschränkung nach Seitenart: `isTemplate: true` nur Vorlagen,
 * `false` keine Vorlagen, ohne Angabe beides.
 */
export type LivePageFilter = { isTemplate?: boolean };

/**
 * Bedingung für genau eine Seite aus Nutzerhand: im Space, sichtbar,
 * nicht im Papierkorb. Exportiert für Schreibzugriffe, die dieselbe
 * Bindung brauchen, aber keine Seite laden (etwa `updateMany`).
 */
export function livePageWhere(
  scope: PageScope,
  pageId: string,
  filter: LivePageFilter = {},
): Prisma.PageWhereInput {
  return {
    id: pageId,
    ...scopeWhere(scope),
    deletedAt: null,
    ...(filter.isTemplate === undefined
      ? {}
      : { isTemplate: filter.isTemplate }),
  };
}

/** Seite im Space, sichtbar, nicht im Papierkorb. */
export async function findLivePage(
  scope: PageScope,
  pageId: string,
  filter: LivePageFilter = {},
) {
  return selectLivePage(scope, pageId, { id: true, title: true }, filter);
}

/**
 * Wie `findLivePage`, aber mit den Feldern, die der Aufrufer braucht
 * (Inhalt, Position …). Dieselbe Bindung in derselben Abfrage: ein
 * zweiter Schritt, der die Daten erst nach der Prüfung lädt, sähe einen
 * späteren Stand als die Prüfung.
 */
export async function selectLivePage<S extends Prisma.PageSelect>(
  scope: PageScope,
  pageId: string,
  select: S,
  filter: LivePageFilter = {},
): Promise<Prisma.PageGetPayload<{ select: S }> | null> {
  if (!pageId) return null;
  return prisma.page.findFirst({
    where: livePageWhere(scope, pageId, filter),
    select,
  });
}

/** Seite im Space, sichtbar, die im Papierkorb liegt. */
export async function findTrashedPage(scope: PageScope, pageId: string) {
  if (!pageId) return null;
  return prisma.page.findFirst({
    where: { id: pageId, ...scopeWhere(scope), NOT: { deletedAt: null } },
    select: { id: true, title: true },
  });
}

/** Version einer Seite, die diese Person in diesem Space sehen darf. */
export async function findRestorableVersion(
  scope: PageScope,
  versionId: string,
) {
  if (!versionId) return null;
  return prisma.pageVersion.findFirst({
    where: {
      id: versionId,
      page: { ...scopeWhere(scope), deletedAt: null },
    },
    select: {
      id: true,
      pageId: true,
      title: true,
      content: true,
      textContent: true,
      createdAt: true,
    },
  });
}

/**
 * Prüft eine optionale Elternseite. Gibt die ID zurück, wenn sie im
 * Space liegt, null wenn kein Elternteil gewünscht ist, und wirft bei
 * einer fremden ID — sonst entstünden Seiten, deren Elternteil in einem
 * anderen Space hängt und die im Baum nirgends auftauchen.
 *
 * Aus demselben Grund keine Vorlage: Vorlagen stehen nicht im Seitenbaum,
 * eine Seite darunter wäre ebenso unauffindbar.
 */
export async function resolveParentId(
  scope: PageScope,
  parentId: string | null,
): Promise<string | null> {
  if (!parentId) return null;
  const parent = await findLivePage(scope, parentId, { isTemplate: false });
  if (!parent) throw new Error("Elternseite gehört nicht zu diesem Space");
  return parent.id;
}

/**
 * Obergrenze für einen Seitentitel — dieselbe wie beim Import
 * (`lib/import/run.ts`), damit ein importierter und ein getippter Titel
 * nicht unterschiedlich weit reichen.
 */
export const PAGE_TITLE_MAX = 200;

/**
 * Benennt eine Seite um, sofern sie in diesem Space liegt.
 * Rückgabe: false, wenn keine passende Seite getroffen wurde.
 */
export async function renamePageInSpace(
  scope: PageScope,
  pageId: string,
  title: string,
): Promise<boolean> {
  if (!pageId) return false;
  const { count } = await prisma.page.updateMany({
    where: { id: pageId, ...scopeWhere(scope), deletedAt: null },
    // Nach oben gekappt, nicht nur nach unten aufgefangen: `Page.title`
    // ist ein unbegrenztes Textfeld und das Titelfeld im Editor kennt
    // kein maxLength. Ohne das Kappen landete ein Titel bis zur Grösse
    // des Action-Limits im Seitenbaum, in den Breadcrumbs und in jeder
    // Seitenliste — überall dort, wo er ungekürzt gerendert wird.
    data: { title: title.slice(0, PAGE_TITLE_MAX) || DEFAULT_PAGE_TITLE },
  });
  return count > 0;
}

/**
 * Enthält der Unterbaum eine Seite, die diese Person nicht sehen darf?
 *
 * `findLivePage` bindet nur die oberste Seite an Space und
 * Sichtbarkeit; der Lauf durch den Unterbaum kennt danach nur noch die
 * Space-Grenze. Wer die offene Elternseite sehen darf, legte damit auch
 * geschützte Unterseiten in den Papierkorb und löschte sie im zweiten
 * Schritt endgültig, samt Versionen und Kommentaren — Seiten, die ihm
 * nie angezeigt wurden. Wer etwas nicht sehen darf, darf es auch nicht
 * zerstören: die Aufrufer brechen bei `true` ab.
 *
 * Bewusst der ganze Unterbaum und nicht nur das Sichtbare: ein Lauf,
 * der an der geschützten Seite anhält, liesse sie mit einem gelöschten
 * Elternteil zurück und damit in einem Zustand, den der Seitenbaum
 * nicht mehr darstellt.
 */
export async function subtreeHasHiddenPages(
  scope: PageScope,
  pageId: string,
): Promise<boolean> {
  if (!pageId) return false;
  // Die Verwaltung sieht ohnehin jede Seite des Space.
  if (seesEverything(scope.role)) return false;
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page"
      WHERE id = ${pageId} AND "spaceId" = ${scope.spaceId}
      UNION ALL
      SELECT c.id FROM "Page" c JOIN sub ON c."parentId" = sub.id
      WHERE c."spaceId" = ${scope.spaceId}
    )
    SELECT count(*)::int AS n FROM "Page" p
    WHERE p.id IN (SELECT id FROM sub)
      AND NOT ${visiblePageSql(scope.userId, [])}
  `;
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Legt Seite und Unterbaum in den Papierkorb (Soft-Delete).
 * Die rekursive CTE bleibt in jedem Schritt im Space, damit ein
 * untergeschobener Elternbezug den Lauf nicht über die Grenze trägt.
 *
 * Der Aufrufer muss vorher `subtreeHasHiddenPages` fragen: hier unten
 * ist die handelnde Person nicht mehr bekannt.
 */
export async function trashPageTree(
  spaceId: string,
  pageId: string,
  tx: Pick<typeof prisma, "$executeRaw"> = prisma,
): Promise<void> {
  await tx.$executeRaw`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${spaceId}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${spaceId}
    )
    UPDATE "Page" SET "deletedAt" = now()
    WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NULL
  `;
}

/**
 * Holt Seite und gelöschten Unterbaum aus dem Papierkorb zurück und
 * hängt die Seite an die oberste Ebene, falls ihr Elternteil noch im
 * Papierkorb liegt.
 *
 * Beides gehört zusammen und deshalb hierher und nicht in die Server
 * Action: eine Seite unter einem noch gelöschten Elternteil taucht im
 * Baum zwar als Wurzel auf (elternlose Knoten werden befördert), ihre
 * `position` gehört aber zu den alten Geschwistern, sodass Sortierung
 * und Verschieben durcheinandergeraten. Wer nur den ersten Schritt
 * aufriefe, bekäme genau diesen halben Zustand.
 *
 * Nur im Client einer laufenden Transaktion: die Schritte müssen
 * gemeinsam gelten, und die Sperre der Geschwisterreihe (siehe unten)
 * hält nur innerhalb einer Transaktion.
 */
export async function restorePageTree(
  spaceId: string,
  pageId: string,
  tx: Pick<typeof prisma, "$executeRaw" | "$queryRaw" | "page">,
): Promise<void> {
  // Die Sperre der obersten Geschwisterreihe ZUERST, vor jeder
  // Zeilensperre. detachLiveChildren (endgültiges Löschen) nimmt sie
  // ebenfalls als Erstes und sperrt danach Zeilen im selben Unterbaum.
  // Holte diese Funktion sie erst nach dem UPDATE unten, stünden sich
  // beide in umgekehrter Reihenfolge gegenüber: Wiederherstellen hält
  // die Zeile und wartet auf die Sperre, Löschen hält die Sperre und
  // wartet auf die Zeile — Postgres bricht dann eine der beiden mit
  // einem Deadlock ab. Gebraucht wird sie nur, wenn die Seite an die
  // oberste Ebene wandert; genommen wird sie immer, damit die
  // Reihenfolge nicht vom Datenstand abhängt.
  await lockSiblingOrder(tx, spaceId, null);
  await tx.$executeRaw`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${spaceId}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${spaceId}
    )
    UPDATE "Page" SET "deletedAt" = NULL
    WHERE id IN (SELECT id FROM sub) AND "deletedAt" IS NOT NULL
  `;

  // Nur die oberste Seite kann noch an einem gelöschten Elternteil
  // hängen; alles darunter ist eben mit ihr zurückgekommen.
  const [stranded] = await tx.$queryRaw<{ isTemplate: boolean }[]>`
    SELECT p."isTemplate" FROM "Page" p
    JOIN "Page" parent ON parent.id = p."parentId"
    WHERE p.id = ${pageId} AND p."spaceId" = ${spaceId}
      AND parent."deletedAt" IS NOT NULL
  `;
  if (!stranded) return;

  // Ans Ende der obersten Ebene, nach derselben Regel wie jede neu
  // angelegte Seite: Vorlagen zählen dort nicht mit, und die Sperre der
  // Geschwisterreihe gilt auch hier. Eine eigene Rechnung an dieser
  // Stelle zählte die Vorlagen mit und lief ohne Sperre.
  const position = await nextSiblingPosition(
    tx,
    spaceId,
    null,
    stranded.isTemplate,
  );
  await tx.$executeRaw`
    UPDATE "Page" SET "parentId" = NULL, position = ${position}
    WHERE id = ${pageId} AND "spaceId" = ${spaceId}
  `;
}

/**
 * Hängt alle lebenden Kinder irgendwo im gelöschten Unterbaum von
 * `pageId` an die oberste Ebene (hinter die bestehenden Wurzelseiten)
 * und gibt sie zurück.
 *
 * Vor dem endgültigen Löschen nötig: `Page.parentId` kaskadiert (ON
 * DELETE CASCADE), und eine wiederhergestellte Unterseite unter einem
 * noch gelöschten Elternteil ist ein völlig normaler Zustand. Ohne das
 * Abhängen würde sie still mitgelöscht — samt Versionen, Kommentaren
 * und eigenem Unterbaum.
 *
 * Der Aufrufer muss für die zurückgegebenen Äste `refreshAccessRoots`
 * nachziehen: sie haben ihre Zugriffswurzel im gelöschten Unterbaum
 * verloren.
 */
export async function detachLiveChildren(
  spaceId: string,
  pageId: string,
  // Ohne Vorgabe: die Sperre aus nextSiblingPosition hält nur innerhalb
  // einer Transaktion.
  tx: Pick<typeof prisma, "$queryRaw" | "$executeRaw" | "page">,
): Promise<{ id: string }[]> {
  // Die erste freie Position auf oberster Ebene nach derselben Regel wie
  // beim Anlegen (Vorlagen zählen nicht mit) und unter derselben Sperre;
  // die abgehängten Äste reihen sich von dort an hintereinander ein.
  const first = await nextSiblingPosition(tx, spaceId, null);
  return tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page"
      WHERE id = ${pageId} AND "spaceId" = ${spaceId}
        AND "deletedAt" IS NOT NULL
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${spaceId} AND p."deletedAt" IS NOT NULL
    ), orphan AS (
      SELECT p.id, row_number() OVER (ORDER BY p.position, p.title) AS n
      FROM "Page" p
      WHERE p."spaceId" = ${spaceId} AND p."deletedAt" IS NULL
        AND p."parentId" IN (SELECT id FROM sub)
    )
    UPDATE "Page" SET "parentId" = NULL,
      position = ${first - 1}::int + orphan.n
    FROM orphan WHERE "Page".id = orphan.id
    RETURNING "Page".id
  `;
}

/**
 * Loescht einen geloeschten Ast endgueltig: lebende Kinder vorher an die
 * oberste Ebene haengen, dann die Seite (Kaskade nimmt die geloeschten
 * Nachfahren mit), danach die Zugriffswurzeln der abgehaengten Aeste
 * nachziehen. purged false, wenn die Seite nicht mehr im Papierkorb liegt
 * oder weg ist. Zeitgrenze wie deleteSpaceWithUploads: ein grosser Ast mit
 * Versionen, Kommentaren und Chunks braucht laenger als Prismas Vorgabe von
 * 5 s. Die Rechtepruefung (subtreeHasHiddenPages) macht der Aufrufer, wo
 * es eine handelnde Person gibt.
 */
export async function purgeTrashedTree(
  spaceId: string,
  pageId: string,
): Promise<{ purged: boolean; detached: { id: string }[] }> {
  const { purged, detached } = await prisma.$transaction(
    async (tx) => {
      const orphans = await detachLiveChildren(spaceId, pageId, tx);
      // Jetzt trifft die Kaskade nur noch geloeschte Seiten.
      const { count } = await tx.page.deleteMany({
        where: { id: pageId, spaceId, NOT: { deletedAt: null } },
      });
      return { purged: count > 0, detached: orphans };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  // Die abgehaengten Aeste haben ihre Zugriffswurzel im geloeschten
  // Unterbaum verloren; sie muessen neu berechnet werden, sonst stuende
  // eine geschuetzte Seite ploetzlich offen da.
  for (const o of detached) await refreshAccessRoots(o.id);
  return { purged, detached };
}

/**
 * Ist `candidateId` ein Nachfahre von `pageId`?
 *
 * Muss vor jedem Verschieben geprüft werden: eine Seite unter ihre
 * eigene Unterseite zu hängen, schneidet den ganzen Ast vom Baum ab —
 * er wäre in der Oberfläche nicht mehr erreichbar und liesse sich auch
 * nicht mehr zurückholen. `movePageInSpace` ist der einzige
 * Produktivpfad und fragt hier; die Abfrage stand dort vorher ein
 * zweites Mal inline, sodass der Test eine Funktion prüfte, die im
 * Betrieb niemand aufrief, und der laufende Zyklus-Schutz ungetestet
 * blieb.
 *
 * Optional im Client einer laufenden Transaktion: der Aufruf in
 * `movePageInSpace` muss denselben Baum sehen wie das Umhängen
 * danach, sonst prüfte er einen Stand von vor der Transaktion.
 */
export async function isDescendantOf(
  spaceId: string,
  pageId: string,
  candidateId: string,
  tx: Pick<typeof prisma, "$queryRaw"> = prisma,
): Promise<boolean> {
  if (pageId === candidateId) return true;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE sub AS (
      SELECT id FROM "Page" WHERE id = ${pageId} AND "spaceId" = ${spaceId}
      UNION ALL
      SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      WHERE p."spaceId" = ${spaceId}
    )
    SELECT id FROM sub WHERE id = ${candidateId} LIMIT 1
  `;
  return rows.length > 0;
}

export type MoveResult = { ok: true } | { ok: false; error: string };

/**
 * Hängt eine Seite an einen neuen Platz im Baum und schreibt die
 * Reihenfolge der betroffenen Geschwister neu.
 *
 * Alle inhaltlichen Regeln stehen hier und nicht in der Server Action:
 * die Action darf nur Rolle und Formular aufloesen. Sonst gaebe es die
 * Regeln zweimal — einmal getestet, einmal im Einsatz.
 *
 * `index` ist die Zielposition in der Geschwisterliste ohne die
 * verschobene Seite; ohne Angabe kommt sie ans Ende.
 */
export async function movePageInSpace(
  scope: PageScope,
  pageId: string,
  parentId: string | null,
  index?: number,
): Promise<MoveResult> {
  if (index !== undefined && !Number.isInteger(index)) {
    return { ok: false, error: "Ungültige Zielposition" };
  }
  const where = scopeWhere(scope);

  const result = await prisma.$transaction(async (tx): Promise<MoveResult> => {
    // Nur sichtbare Seiten dieses Space, nicht im Papierkorb, keine Vorlage.
    const page = await tx.page.findFirst({
      where: { id: pageId, ...where, deletedAt: null, isTemplate: false },
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
        where: { id: parentId, ...where, deletedAt: null, isTemplate: false },
        select: { id: true },
      });
      if (!parent) return { ok: false, error: "Zielseite nicht gefunden" };

      // Zyklus-Check: die Zielseite darf kein Nachfahre der Seite sein.
      if (await isDescendantOf(scope.spaceId, page.id, parentId, tx)) {
        return {
          ok: false,
          error:
            "Eine Seite kann nicht unter eine ihrer eigenen Unterseiten verschoben werden",
        };
      }
    }

    const siblingWhere = {
      spaceId: scope.spaceId,
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
      where: { id: page.id, spaceId: scope.spaceId },
      data: {
        parentId,
        position: own?.position ?? ordered.indexOf(page.id),
      },
    });
    // Rohes SQL fuer die Geschwister: `updateMany` wuerde ueber Prismas
    // @updatedAt auch deren Zeitstempel anfassen — unbeteiligte Seiten
    // stuenden dann als "zuletzt geaendert" im Dashboard.
    for (const u of updates) {
      if (u.id === page.id) continue;
      await tx.$executeRaw`
        UPDATE "Page" SET position = ${u.position}
        WHERE id = ${u.id} AND "spaceId" = ${scope.spaceId}
      `;
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
        await tx.$executeRaw`
          UPDATE "Page" SET position = ${u.position}
          WHERE id = ${u.id} AND "spaceId" = ${scope.spaceId}
        `;
      }
    }

    // Der Zug kann den Ast unter eine geschuetzte Seite gehaengt oder aus
    // ihr herausgeholt haben; ohne das Nachziehen bliebe der Unterbaum mit
    // der alten Zugriffswurzel stehen — sichtbar fuer die Falschen.
    //
    // Bewusst INNERHALB der Transaktion: draussen bliebe bei einem Fehler
    // der Zug bestehen, die Action wuerde trotzdem werfen, und damit fiele
    // auch das revalidatePath aus — verschobene Seite, alte Anzeige, und
    // fuer die handelnde Person eine Fehlermeldung.
    await refreshAccessRoots(page.id, tx);

    return { ok: true };
  });

  return result;
}
