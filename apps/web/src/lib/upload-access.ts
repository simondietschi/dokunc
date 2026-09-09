import "server-only";
import { prisma } from "@dokunc/db";

/**
 * Findet eine hochgeladene Datei, aber nur wenn die anfragende Person
 * im zugehörigen Space Mitglied ist.
 *
 * Eine Abfrage statt zwei, und vor allem: die Zugriffsbedingung steht
 * an einer Stelle, an der sie sich testen lässt.
 */
export async function findReadableUpload(userId: string, filename: string) {
  if (!userId || !filename) return null;
  return prisma.upload.findFirst({
    where: { filename, space: { members: { some: { userId } } } },
    select: {
      filename: true,
      originalName: true,
      contentType: true,
      kind: true,
      spaceId: true,
    },
  });
}
