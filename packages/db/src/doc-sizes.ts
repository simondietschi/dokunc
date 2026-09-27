import { prisma } from "./index";

/*
 * Groesse der gespeicherten Yjs-Staende (CollabDocument.state), fuer die
 * Admin-Liste /admin/documents und den Startcheck des Collab-Servers
 * (Dokumentgrenze COLLAB_MAX_DOC_MB).
 *
 * octet_length statt pg_column_size: octet_length liefert bei bytea die
 * Rohgroesse aus dem TOAST-Zeiger bzw. dem Kopf, ohne zu entpacken, auch
 * bei komprimierter Speicherung. pg_column_size naennte die komprimierte
 * Groesse, und eine Seite aus vielen gleichen Bytes saehe klein aus.
 * Gelesen wird so nur der kleine Hauptteil der Tabelle.
 */

export type CollabDocumentSize = {
  pageId: string;
  bytes: number;
  updatedAt: Date;
  title: string;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  deletedAt: Date | null;
};

/** Die groessten gespeicherten Yjs-Staende, groesste zuerst. */
export async function largestCollabDocuments(
  limit: number,
): Promise<CollabDocumentSize[]> {
  return prisma.$queryRaw<CollabDocumentSize[]>`
    SELECT cd."pageId", octet_length(cd."state")::int AS "bytes",
           cd."updatedAt", p."title", p."spaceId", p."deletedAt",
           s."name" AS "spaceName", s."slug" AS "spaceSlug"
    FROM "CollabDocument" cd
    JOIN "Page" p ON p."id" = cd."pageId"
    JOIN "Space" s ON s."id" = p."spaceId"
    ORDER BY octet_length(cd."state") DESC, cd."pageId"
    LIMIT ${limit}
  `;
}

/** Zahl der gespeicherten Yjs-Staende ueber `bytes`. */
export async function countCollabDocumentsOver(bytes: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n"
    FROM "CollabDocument"
    WHERE octet_length("state") > ${bytes}
  `;
  return rows[0]?.n ?? 0;
}
