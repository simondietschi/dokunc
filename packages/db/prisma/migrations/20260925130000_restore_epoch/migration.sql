-- Restore-Epoche (scripts/restore.sh, Punkt 10). Eine Zeile fuer die ganze
-- Instanz. restore.sh setzt die Epoche NACH dem Einspielen neu; der Wert
-- aus dem Dump gilt danach nicht mehr.
CREATE TABLE "InstanceState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "restoreEpoch" TEXT,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "InstanceState_pkey" PRIMARY KEY ("id"),
    -- Genau eine Zeile.
    CONSTRAINT "InstanceState_single_row" CHECK ("id" = 1),
    -- Das Format von restore.sh. Der Wert steht im Namen einer IndexedDB
    -- (dokunc:<epoche>:<pageId>); ein Doppelpunkt darin machte den Namen
    -- mehrdeutig.
    CONSTRAINT "InstanceState_restoreEpoch_format"
      CHECK ("restoreEpoch" IS NULL OR "restoreEpoch" ~ '^[0-9a-f]{32}$')
);

INSERT INTO "InstanceState" ("id") VALUES (1);
