-- "Seite folgen" meldet auch Aenderungen (Punkt 9).
--
-- PAGE_UPDATED entsteht im Collab-Server, wenn er einen Snapshot schreibt
-- (hoechstens einer je Seite alle zwei Minuten). "versionId" nennt die
-- dabei entstandene Version, ohne Fremdschluessel: Versionen duerfen
-- spaeter ausgeduennt werden, ohne Benachrichtigungen mitzunehmen.
--
-- Die neue Enum-Konstante wird in dieser Migration nirgends benutzt:
-- Postgres erlaubt das erst nach dem Commit ("unsafe use of new value").
-- Deshalb auch kein Teilindex auf type = 'PAGE_UPDATED'; die Regel
-- "hoechstens eine ungelesene je Person und Seite" setzt der
-- Collab-Server im Speicherlauf durch.
--
-- Beides aendert nur den Katalog und wirkt sofort, auch auf grossen
-- Tabellen.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAGE_UPDATED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "versionId" TEXT;
