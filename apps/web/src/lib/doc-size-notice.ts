import type { DocSizeNotice } from "@dokunc/editor";
import { formatFileSize } from "./file-meta";

/**
 * Texte der Groessenhinweise im Editor (Dokumentgrenze COLLAB_MAX_DOC_MB
 * und Nachrichtengrenze COLLAB_MAX_MESSAGE_MB), ohne React und damit
 * testbar.
 */

export type DocSizeBannerContent = {
  tone: "hinweis" | "sperre";
  text: string;
} | null;

/** Hinweis zur Stufe, die der Collab-Server geschickt hat; "ok" oder keine: null. */
export function docSizeBanner(
  notice: DocSizeNotice | null,
): DocSizeBannerContent {
  if (!notice || notice.level === "ok") return null;
  const bytes = formatFileSize(notice.bytes);
  const limit = formatFileSize(notice.limitBytes);
  if (notice.level === "warn") {
    return {
      tone: "hinweis",
      text: `Diese Seite ist sehr gross (${bytes}). Ab ${limit} kann sie nur noch gelesen werden. Teile sie am besten in Unterseiten auf.`,
    };
  }
  return {
    tone: "sperre",
    text: `Diese Seite ist zu gross für die gemeinsame Bearbeitung (${bytes}, erlaubt sind ${limit}) und kann nur noch gelesen werden. Im Verlauf lässt sich eine kleinere Version wiederherstellen; die Grenze kann die Administration anheben.`,
  };
}

/** Hinweis nach Close-Code 1009 (Status "too-large"). */
export const TOO_LARGE_NOTICE =
  "Eine Änderung auf diesem Gerät ist zu gross, um sie an den Server zu übertragen, und die Verbindung ist getrennt. Du kannst die lokale Änderung verwerfen: Was seit der letzten Übertragung auf diesem Gerät an dieser Seite geändert wurde, geht dabei verloren. Kopiere es vorher, falls du es noch brauchst.";

/** Knopf unter dem 1009-Hinweis. */
export const TOO_LARGE_DISCARD_LABEL = "Lokale Änderung verwerfen und neu laden";
