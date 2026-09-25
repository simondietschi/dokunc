-- Aufbewahrung (Punkt 12).
--
-- 1. PageVersion.pinned: Versionen, die das Ausduennen nie loescht
--    (lib/version-thinning.ts). ADD COLUMN mit konstantem Default ist nur
--    Metadaten.
-- 2. Index (pageId, createdAt) statt (pageId): Verlauf mit Cursor, neueste
--    Version je Seite, Ausduennen je Seite. Der alte Index ist ein Praefix
--    des neuen. Der Aufbau liest die Tabelle einmal (schmale Spalten).
-- 3. Notification(readAt): Loeschbedingung des Jobs (gelesen vor Frist).
-- 4. Bestand: Wiederherstellungspunkte aus dem Audit-Log markieren.
-- 5. Bestand: Page.lastEditedById aus der neuesten Version, wo es fehlt.
-- 6. AuditLog.space: SET NULL statt CASCADE, damit die Spur eines
--    geloeschten Space bleibt.

ALTER TABLE "PageVersion" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "PageVersion_pageId_createdAt_idx" ON "PageVersion"("pageId", "createdAt");
DROP INDEX "PageVersion_pageId_idx";

CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- Quelle jeder bisherigen Wiederherstellung.
UPDATE "PageVersion" v SET "pinned" = true
FROM "AuditLog" a
WHERE a."action" = 'page.version_restored'
  AND jsonb_typeof(a."metadata") = 'object'
  AND v."id" = a."metadata"->>'versionId';

-- Stand davor: die zwei neuesten Versionen der Seite vor dem Audit-
-- Eintrag. Zwei, weil der Eintrag erst nach dem Austausch entsteht: war
-- die Snapshot-Drossel frei, liegt der Snapshot des wiederhergestellten
-- Stands schon davor, erst die Version davor ist der alte Stand.
UPDATE "PageVersion" v SET "pinned" = true
FROM (
  SELECT x."id"
  FROM "AuditLog" a
  CROSS JOIN LATERAL (
    SELECT p."id" FROM "PageVersion" p
    WHERE p."pageId" = a."targetId" AND p."createdAt" < a."createdAt"
    ORDER BY p."createdAt" DESC, p."id" DESC
    LIMIT 2
  ) x
  WHERE a."action" = 'page.version_restored' AND a."targetId" IS NOT NULL
) vorher
WHERE v."id" = vorher."id";

-- Wer zuletzt gespeichert hat, fuer Seiten aus der Zeit vor
-- lastEditedById: genau das, was die Seitenansicht bisher zeigte (Autor
-- der neuesten Version). Beruehrt weder updatedAt noch die Trigger aus
-- Punkt 7 und 8 (die hoeren nur auf title/textContent).
UPDATE "Page" p SET "lastEditedById" = (
  SELECT v."authorId" FROM "PageVersion" v
  WHERE v."pageId" = p."id"
  ORDER BY v."createdAt" DESC, v."id" DESC
  LIMIT 1
)
WHERE p."lastEditedById" IS NULL
  AND EXISTS (SELECT 1 FROM "PageVersion" v WHERE v."pageId" = p."id");

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_spaceId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;
