import "server-only";
import { stat, unlink } from "node:fs/promises";
import { prisma, Prisma } from "@dokunc/db";
import { uploadPath, loadUpload } from "@/lib/uploads";
import { effectiveRole } from "@/lib/space-access";
import {
  readablePageRole,
  seesEverything,
  visiblePageSql,
} from "@/lib/page-access";
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
 *
 * Zwei Luecken bleiben, und beide enden gleich: Bytes ohne Datensatz.
 * Ein Upload, der zwischen die Namensliste und das Loeschen faellt,
 * steht nicht in der Liste, seine Zeile faellt aber per Kaskade; und
 * endet der Prozess nach dem Loeschen, bevor `unlink` durch ist, bleibt
 * der Rest liegen. Beides laesst sich hier nicht schliessen: nach dem
 * Loeschen ist nicht mehr nachzulesen, welche Dateien zum Space
 * gehoerten. Dafuer braucht es einen Aufraeumjob, der Dateien ohne
 * Attachment-Zeile einsammelt — den gibt es noch nicht, `unlink` kommt
 * im ganzen Repository nur hier und in api/upload vor.
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
 *
 * Fehlt der Seitenbezug, gilt dieselbe Huerde ueber die Seiten, die die
 * Datei verwenden (siehe `pagelessAttachmentReadable`).
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
  if (!attachment.pageId) {
    return (await pagelessAttachmentReadable(attachment, userId))
      ? attachment
      : null;
  }
  const role = await readablePageRole(
    userId,
    attachment.pageId,
    attachment.spaceId,
  );
  return role ? attachment : null;
}

/**
 * Darf die Person einen Anhang ohne Seitenbezug sehen?
 *
 * Solche Anhaenge sind KEINE Space-weiten Dateien, die bewusst allen
 * gehoeren. Sie entstehen auf drei Wegen, und zwei davon fuehren direkt
 * aus geschuetzten Seiten heraus:
 * - Aeltere Uploads: der Editor hat Bilder, Anhaenge und Titelbilder
 *   eine Zeit lang ohne `pageId` an /api/upload geschickt — auch noch,
 *   als es geschuetzte Seiten schon gab. Ein Bild aus einer geschuetzten Seite
 *   steht deshalb unter Umstaenden ohne Seitenbezug in der Datenbank.
 * - Endgueltiges Loeschen: `Attachment.pageId` steht auf ON DELETE SET
 *   NULL. Wer eine Seite aus dem Papierkorb entfernt, macht aus jedem
 *   ihrer Anhaenge einen ohne Seitenbezug, die Datei bleibt liegen.
 * - /api/upload nimmt `pageId` weiterhin nur optional an; die
 *   Oberflaeche schickt sie inzwischen immer mit.
 * Sie allein am Space-Zugang zu messen, gab damit jedem Mitglied, das
 * den Dateinamen kennt, die Bilder geschuetzter Seiten. Die Freigabe-
 * Route (api/share/[id]/files/[name]) liefert sie aus demselben Grund
 * gar nicht aus.
 *
 * Ganz abweisen laesst sich das hier nicht: dann verschwaenden alle
 * aelteren Bilder auch aus offenen Seiten, und die Freigabe-Route
 * verweist ausdruecklich auf /api/files als den Weg, auf dem sie mit
 * Konto erreichbar bleiben. Stattdessen ersetzt der Inhalt den
 * fehlenden Seitenbezug: gesucht werden die Seiten des Space, die die Datei
 * im Inhalt, als Titelbild oder in einer ihrer Versionen verwenden —
 * lebend oder im Papierkorb, wie bei `canSeePage`. Lesbar ist die Datei
 * nur, wenn es mindestens eine solche Seite gibt und die Person JEDE
 * davon sehen darf.
 *
 * "Jede" und nicht "irgendeine": sonst genuegte es, den bekannten
 * Dateinamen in eine eigene offene Seite zu schreiben, um das Bild einer
 * geschuetzten Seite freizuschalten. So bleibt es bei der Regel eines
 * Anhangs mit Seitenbezug: steckt er in einer geschuetzten Seite, sieht
 * ihn nur, wer diese Seite sieht. Steckt dieselbe Datei in einer offenen
 * UND in einer geschuetzten Seite, bleibt sie fuer Aussenstehende
 * verborgen: ohne Seitenbezug laesst sich nicht sagen, wo sie herkommt.
 * Eine Datei, die keine Seite mehr verwendet, bekommt niemand ausser der
 * Verwaltung, die ohnehin jede Seite des Space sieht.
 */
async function pagelessAttachmentReadable(
  attachment: AttachmentInfo,
  userId: string,
): Promise<boolean> {
  const role = await effectiveRole(userId, attachment.spaceId);
  if (!role) return false;
  if (seesEverything(role)) return true;

  const like = `%/api/files/${likeEscape(attachment.storedName)}%`;
  const sichtbar = visiblePageSql(userId, []);
  // `IS NOT TRUE` statt `NOT`: visiblePageSql liefert heute nur noch TRUE
  // oder FALSE. Frueher ergab es bei leerer Spaceliste NULL (`IN (NULL)`),
  // und NOT NULL bliebe NULL — die Seite fiele aus der Zaehlung, statt als
  // verborgen zu gelten. Die Form bleibt als Absicherung, falls der
  // Baustein je wieder NULL liefern sollte.
  const rows = await prisma.$queryRaw<{ treffer: number; verborgen: number }[]>(
    Prisma.sql`
      SELECT count(*)::int AS treffer,
        count(*) FILTER (WHERE ${sichtbar} IS NOT TRUE)::int AS verborgen
      FROM "Page" p
      WHERE p."spaceId" = ${attachment.spaceId}
        AND (
          p.content::text LIKE ${like}
          OR p."coverUrl" LIKE ${like}
          OR EXISTS (
            SELECT 1 FROM "PageVersion" v
            WHERE v."pageId" = p.id AND v.content::text LIKE ${like}
          )
        )
    `,
  );
  const { treffer = 0, verborgen = 0 } = rows[0] ?? {};
  return treffer > 0 && verborgen === 0;
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
