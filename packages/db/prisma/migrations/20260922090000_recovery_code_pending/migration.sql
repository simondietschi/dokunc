-- Wiederherstellungscodes gelten erst nach Bestaetigung.
--
-- Neu ausgegebene Codes entstehen als ausstehend: "pendingUntil" traegt
-- die Frist, bis zu der die Person einen der neuen Codes eintippen muss.
-- Bis dahin loesen sie nichts ein und die bisherigen Codes bleiben
-- gueltig; erst die Bestaetigung tauscht beide Saetze in einer
-- Transaktion aus (lib/totp-store.ts). Vorher stand der neue Satz sofort
-- scharf und der alte war weg — kam die Antwort mit dem Klartext nicht
-- an, hatte das Konto den zweiten Faktor aktiv und keinen brauchbaren
-- Wiederherstellungscode mehr.
--
-- NULL heisst aktiv. Bestehende Zeilen behalten damit ohne Datenmigration
-- ihre Gueltigkeit.

-- AlterTable
ALTER TABLE "TotpRecoveryCode" ADD COLUMN     "pendingUntil" TIMESTAMP(3);
