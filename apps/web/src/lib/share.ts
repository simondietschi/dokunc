import "server-only";
import { prisma } from "@dokunc/db";
import { verifyToken } from "./invitations";

export type ShareTarget = {
  shareId: string;
  spaceId: string;
  page: {
    id: string;
    title: string;
    icon: string | null;
    coverUrl: string | null;
    content: unknown;
    updatedAt: Date;
  };
  spaceName: string;
  includeChildren: boolean;
};

/**
 * Löst einen Freigabelink auf.
 *
 * Gültig ist er nur, wenn er nicht zurückgezogen und nicht abgelaufen
 * ist, die Seite noch existiert und das Token zum gespeicherten Hash
 * passt. Ohne diese Auflösung gäbe es keinen Lesezugriff ohne Konto —
 * mit ihr genau einen, und nur auf die freigegebene Seite.
 */
export async function resolveShare(
  shareId: string,
  token: string,
  pageId?: string,
): Promise<ShareTarget | null> {
  if (!shareId || !token) return null;

  const share = await prisma.pageShare.findUnique({
    where: { id: shareId },
    select: {
      id: true,
      tokenHash: true,
      revokedAt: true,
      expiresAt: true,
      includeChildren: true,
      pageId: true,
      page: {
        select: {
          id: true,
          spaceId: true,
          deletedAt: true,
          space: { select: { name: true } },
        },
      },
    },
  });

  if (
    !share ||
    share.revokedAt !== null ||
    (share.expiresAt !== null && share.expiresAt.getTime() < Date.now()) ||
    share.page.deletedAt !== null ||
    !verifyToken(token, share.tokenHash)
  ) {
    return null;
  }

  // Ohne abweichende Seite: die freigegebene selbst.
  const wanted = pageId ?? share.pageId;
  if (wanted !== share.pageId && !share.includeChildren) return null;

  const page = await prisma.page.findFirst({
    where: {
      id: wanted,
      spaceId: share.page.spaceId,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      icon: true,
      coverUrl: true,
      content: true,
      updatedAt: true,
    },
  });
  if (!page) return null;

  // Unterseiten nur, wenn sie wirklich unterhalb der Freigabe hängen.
  if (wanted !== share.pageId) {
    const inSubtree = await prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE sub AS (
        SELECT id FROM "Page" WHERE id = ${share.pageId}
        UNION ALL
        SELECT p.id FROM "Page" p JOIN sub ON p."parentId" = sub.id
      )
      SELECT id FROM sub WHERE id = ${wanted}
    `;
    if (inSubtree.length === 0) return null;
  }

  return {
    shareId: share.id,
    spaceId: share.page.spaceId,
    page,
    spaceName: share.page.space.name,
    includeChildren: share.includeChildren,
  };
}

/**
 * Schreibt Datei-URLs im gerenderten HTML auf die Freigabe um.
 *
 * `/api/files` verlangt eine Anmeldung — ohne diese Umschreibung wären
 * in einer geteilten Seite alle Bilder und Anhänge kaputt.
 */
export function rewriteFileUrls(
  html: string,
  shareId: string,
  token: string,
): string {
  const suffix = `?token=${encodeURIComponent(token)}`;
  return html.replace(
    /\/api\/files\/([a-zA-Z0-9._-]+)/g,
    (_match, name: string) => `/api/share/${shareId}/files/${name}${suffix}`,
  );
}
