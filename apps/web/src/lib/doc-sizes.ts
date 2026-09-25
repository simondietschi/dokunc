import "server-only";
import {
  canSeePage,
  effectiveSpaceRole,
  largestCollabDocuments,
  type SpaceRole,
} from "@dokunc/db";
import {
  docSizeLevel,
  readDocSizeLimits,
  type DocSizeLevel,
  type DocSizeLimits,
} from "@dokunc/editor";

/**
 * Die groessten Seiten fuer die Admin-Liste /admin/documents, nach
 * Groesse ihres gespeicherten Yjs-Stands (Dokumentgrenze
 * COLLAB_MAX_DOC_MB).
 *
 * Instanz-Admins sind nicht automatisch Mitglied eines Space, und eine
 * geschuetzte Seite bleibt auch Mitgliedern ohne Freigabe verborgen.
 * Groesse, Space und Zeitpunkt zeigt die Liste immer (dafuer ist sie
 * da), Titel und Link nur, wenn die Person die Seite auch sehen darf.
 */
export type DocSizeRow = {
  pageId: string;
  bytes: number;
  updatedAt: Date;
  spaceName: string;
  level: DocSizeLevel;
  /** null: die Person darf die Seite nicht sehen. */
  title: string | null;
  /** null: nicht sichtbar oder im Papierkorb. */
  href: string | null;
  inTrash: boolean;
};

export async function largestDocumentsFor(
  userId: string,
  limit = 20,
): Promise<{ rows: DocSizeRow[]; limits: DocSizeLimits }> {
  // Ohne Warnung: ungueltige Werte meldet der Collab-Server beim Start,
  // eine Seite, die die Grenzen nur anzeigt, schriebe sonst bei jedem
  // Aufruf dieselbe Zeile ins Log.
  const limits = readDocSizeLimits(process.env, () => undefined);
  const docs = await largestCollabDocuments(limit);

  const roles = new Map<string, Promise<SpaceRole | null>>();
  const roleIn = (spaceId: string) => {
    let role = roles.get(spaceId);
    if (!role) {
      role = effectiveSpaceRole(userId, spaceId);
      roles.set(spaceId, role);
    }
    return role;
  };

  const rows: DocSizeRow[] = [];
  for (const doc of docs) {
    const role = await roleIn(doc.spaceId);
    const visible = !!role && (await canSeePage(doc.pageId, userId, role));
    const inTrash = doc.deletedAt !== null;
    rows.push({
      pageId: doc.pageId,
      bytes: doc.bytes,
      updatedAt: doc.updatedAt,
      spaceName: doc.spaceName,
      level: docSizeLevel(doc.bytes, limits),
      title: visible ? doc.title : null,
      href:
        visible && !inTrash ? `/s/${doc.spaceSlug}/p/${doc.pageId}` : null,
      inTrash,
    });
  }
  return { rows, limits };
}
