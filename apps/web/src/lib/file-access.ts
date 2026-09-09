import "server-only";
import { stat, unlink } from "node:fs/promises";
import { prisma, Prisma } from "@dokunc/db";
import { uploadPath, loadUpload } from "@/lib/uploads";
import { effectiveRole } from "@/lib/space-access";
import { readablePageRole } from "@/lib/page-access";
import {
  likeEscape,
  resolveFileAccess,
  type AttachmentInfo,
  type FileAccessDeps,
} from "@/lib/attachments";

/**
 * Gemeinsame Prisma-/Dateisystem-Anbindung der Zugriffslogik aus
 * `attachments.ts`. Bewusst EINE Stelle: jeder Weg, auf dem Bytes aus
 * dem Upload-Verzeichnis den Server verlassen (Auslieferung unter
 * /api/files, Einbettung in Export/Druck), muss durch dieselbe Pruefung.
 *
 * Zwei Dinge entscheiden ueber den Zugriff, und beide muessen stimmen:
 * die wirksame Rolle im Space (direkt ODER ueber eine Gruppe, siehe
 * lib/space-access) und — sobald der Anhang an einer Seite haengt — die
 * Sichtbarkeit dieser Seite. Ohne das zweite waere der Anhang einer
 * geschuetzten Seite ueber seinen Namen weiterhin fuer jedes
 * Space-Mitglied lesbar.
 */

const attachmentSelect = {
  id: true,
  spaceId: true,
  pageId: true,
  storedName: true,
  name: true,
  mimeType: true,
  size: true,
} as const;

export const fileAccessDeps: FileAccessDeps = {
  findAttachment: (storedName) =>
    prisma.attachment.findUnique({
      where: { storedName },
      select: attachmentSelect,
    }),
  // Zugang, nicht Mitgliedschaft: wer den Space nur ueber eine Gruppe
  // sieht, verliert sonst still den Zugriff auf dessen Dateien.
  isMember: async (userId, spaceId) =>
    (await effectiveRole(userId, spaceId)) !== null,
  findLegacyPage: async (storedName, userId) => {
    // Altbestand ohne Datensatz: die Seite finden, deren Inhalt die Datei
    // referenziert. Parameterisiert (kein SQL aus Nutzerdaten).
    //
    // Nur Spaces, zu denen die anfragende Person ohnehin Zugang hat —
    // direkt oder ueber eine Gruppe: sonst entscheidet die zuletzt
    // bearbeitete Seite IRGENDWO auf der Instanz, wem die Datei gehoert
    // — wer den Namen einer verwaisten Datei kennt, koennte sie durch
    // Einfuegen in eine eigene Seite an seinen Space binden
    // (createAttachment schreibt die Zuordnung fest).
    const like = `%/api/files/${likeEscape(storedName)}%`;
    const rows = await prisma.$queryRaw<{ id: string; spaceId: string }[]>(
      Prisma.sql`
        SELECT p.id, p."spaceId" FROM "Page" p
        WHERE p."deletedAt" IS NULL
          AND p.content::text LIKE ${like}
          AND (
            EXISTS (
              SELECT 1 FROM "SpaceMember" m
              WHERE m."spaceId" = p."spaceId" AND m."userId" = ${userId}
            )
            OR EXISTS (
              SELECT 1 FROM "SpaceGroup" sg
              JOIN "GroupMember" gm ON gm."groupId" = sg."groupId"
              WHERE sg."spaceId" = p."spaceId" AND gm."userId" = ${userId}
            )
          )
        ORDER BY p."updatedAt" DESC
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
  },
  fileSize: async (storedName) => {
    const full = uploadPath(storedName);
    if (!full) return null;
    try {
      const s = await stat(full);
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  },
  createAttachment: (data) =>
    prisma.attachment.create({ data, select: attachmentSelect }),
};

/**
 * Space endgueltig loeschen und dabei die Dateien seiner Anhaenge von der
 * Platte raeumen. Die Attachment-Zeilen fallen per Kaskade — die Bytes
 * nicht: ohne diesen Schritt bleiben sie als verwaiste Dateien liegen.
 * Die Namen muessen VOR dem Loeschen gelesen werden.
 */
export async function deleteSpaceWithUploads(spaceId: string): Promise<void> {
  const attachments = await prisma.attachment.findMany({
    where: { spaceId },
    select: { storedName: true },
  });
  await prisma.space.delete({ where: { id: spaceId } });
  await Promise.all(
    attachments.map(async (a) => {
      const full = uploadPath(a.storedName);
      if (!full) return;
      await unlink(full).catch(() => undefined);
    }),
  );
}

/**
 * Anhang aufloesen, wenn die Person ihn sehen darf — sonst null.
 *
 * Zweite Huerde nach dem Space: haengt der Anhang an einer Seite, muss
 * auch diese Seite sichtbar sein. Sonst waere der Anhang einer
 * geschuetzten Seite der eine Weg, ihren Inhalt trotzdem zu lesen —
 * genau die Luecke, die der Seitenbezug schliesst.
 */
export async function findReadableAttachment(
  storedName: string,
  userId: string,
): Promise<AttachmentInfo | null> {
  if (!storedName || !userId) return null;
  const attachment = await resolveFileAccess(
    storedName,
    userId,
    fileAccessDeps,
  );
  if (!attachment) return null;
  if (!attachment.pageId) return attachment;
  const role = await readablePageRole(
    userId,
    attachment.pageId,
    attachment.spaceId,
  );
  return role ? attachment : null;
}

/**
 * Lader fuer `inlineUploadImages`: liefert eine Datei nur, wenn die
 * anfragende Person sie auch ueber /api/files abrufen duerfte. Ohne das
 * waere der Export ein zweiter, ungeschuetzter Lesepfad auf dasselbe
 * Verzeichnis — ein `<img src="/api/files/…">` mit fremdem Namen in einer
 * eigenen Seite genuegte, um beliebige Anhaenge der Instanz zu lesen.
 */
export function uploadLoaderFor(userId: string) {
  return async (name: string) => {
    const attachment = await findReadableAttachment(name, userId);
    if (!attachment) return null;
    return loadUpload(name);
  };
}
