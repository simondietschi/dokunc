import "server-only";
import { contentTypeForFile, isInlineImageType } from "./uploads";

/**
 * Zugriffslogik fuer /api/files/<storedName> — bewusst ohne Prisma/FS,
 * die Abhaengigkeiten werden injiziert (testbar).
 *
 * Regel: eine Datei darf nur sehen, wer Mitglied des Space ist, zu dem
 * der Anhang gehoert. Fehlt der Attachment-Datensatz (Uploads aus
 * frueheren Versionen), wird die Seite gesucht, die die Datei im Inhalt
 * referenziert; ist die Person dort Mitglied, wird der Datensatz
 * nachgetragen. Alles andere -> null (404, kein Existenz-Leak).
 */

export type AttachmentInfo = {
  id: string;
  spaceId: string;
  pageId: string | null;
  storedName: string;
  name: string;
  mimeType: string;
  size: number;
};

export type FileAccessDeps = {
  findAttachment: (storedName: string) => Promise<AttachmentInfo | null>;
  isMember: (userId: string, spaceId: string) => Promise<boolean>;
  /** Nicht geloeschte Seite, deren Inhalt die Datei referenziert. */
  findLegacyPage: (
    storedName: string,
  ) => Promise<{ id: string; spaceId: string } | null>;
  /** Dateigroesse auf der Platte oder null, wenn die Datei fehlt. */
  fileSize: (storedName: string) => Promise<number | null>;
  createAttachment: (
    data: Omit<AttachmentInfo, "id">,
  ) => Promise<AttachmentInfo>;
};

export async function resolveFileAccess(
  storedName: string,
  userId: string,
  deps: FileAccessDeps,
): Promise<AttachmentInfo | null> {
  const existing = await deps.findAttachment(storedName);
  if (existing) {
    return (await deps.isMember(userId, existing.spaceId)) ? existing : null;
  }

  // Altbestand: Datei ohne Datensatz — Zuordnung ueber den Seiteninhalt.
  const page = await deps.findLegacyPage(storedName);
  if (!page) return null;
  if (!(await deps.isMember(userId, page.spaceId))) return null;
  const size = await deps.fileSize(storedName);
  if (size === null) return null;

  try {
    return await deps.createAttachment({
      spaceId: page.spaceId,
      pageId: page.id,
      storedName,
      name: storedName,
      mimeType: contentTypeForFile(storedName),
      size,
    });
  } catch {
    // Parallel von einer zweiten Anfrage angelegt (Unique auf storedName):
    // dann den vorhandenen Datensatz verwenden.
    const again = await deps.findAttachment(storedName);
    if (!again) return null;
    return (await deps.isMember(userId, again.spaceId)) ? again : null;
  }
}

/** LIKE-Muster-Zeichen escapen (Backslash ist das Standard-Escape). */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** RFC 5987: UTF-8-Prozentkodierung fuer filename*. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Content-Disposition mit ASCII-Fallback und RFC-5987-kodiertem
 * Originalnamen (Umlaute, Leerzeichen usw. bleiben erhalten).
 */
export function contentDisposition(
  type: "inline" | "attachment",
  name: string,
): string {
  const fallback =
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "datei";
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}

/**
 * Antwort-Header fuer die Auslieferung:
 * - Bilder (png/jpg/gif/webp) inline mit korrektem Typ
 * - PDF inline nur auf Wunsch (?inline=1) und in einer CSP-Sandbox
 * - alles andere als Download (attachment) + nosniff
 * Cache ist privat: die Antwort haengt von der Sitzung ab.
 */
export function fileResponseHeaders(
  att: { name: string; mimeType: string },
  size: number,
  wantInline: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": String(size),
  };
  if (isInlineImageType(att.mimeType)) {
    headers["Content-Type"] = att.mimeType;
    headers["Content-Disposition"] = contentDisposition("inline", att.name);
  } else if (att.mimeType === "application/pdf" && wantInline) {
    headers["Content-Type"] = "application/pdf";
    headers["Content-Disposition"] = contentDisposition("inline", att.name);
    headers["Content-Security-Policy"] = "sandbox";
  } else {
    headers["Content-Type"] = att.mimeType || "application/octet-stream";
    headers["Content-Disposition"] = contentDisposition(
      "attachment",
      att.name,
    );
  }
  return headers;
}
