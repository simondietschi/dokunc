-- KI-Index (Punkt 7): Modell je Embedding und Warteschlange fuer Seiten,
-- deren Chunks nicht mehr zum Text passen.

-- PageChunk.embeddingModel: fuer den Bestand NULL. Der Job im
-- Collab-Prozess (apps/collab/src/ai-indexer.ts) ordnet vorhandene
-- Vektoren nach dem ersten erfolgreichen Stapel dem Modell zu.
ALTER TABLE "PageChunk" ADD COLUMN "embeddingModel" TEXT;

-- Fuer die Suche des Jobs nach Chunks ohne passendes Embedding:
-- (m IS NULL OR m < $1 OR m > $1) wird per BitmapOr bedient. Ohne Index
-- laese jeder Lauf die ganze Tabelle samt Text.
CREATE INDEX "PageChunk_embeddingModel_idx" ON "PageChunk"("embeddingModel");

-- Warteschlange statt Merker-Spalte an Page: eine Spalte in einem
-- Indexpraedikat verhindert HOT-Updates, jedes Speichern schriebe dann
-- alle Page-Indizes ein zweites Mal.
CREATE TABLE "AiIndexQueue" (
    "pageId" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiIndexQueue_pkey" PRIMARY KEY ("pageId")
);

ALTER TABLE "AiIndexQueue" ADD CONSTRAINT "AiIndexQueue_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bestand: jede Seite einmal abgleichen. Der Abgleich schreibt nur, was
-- abweicht (Diff je chunkIndex); vorhandene Embeddings bleiben stehen.
INSERT INTO "AiIndexQueue" ("pageId") SELECT "id" FROM "Page";

-- Trigger: jeder Schreibweg einer Seite, auch Import, Vorlage, Kopie,
-- Wiederherstellen und rohes SQL, stellt sie in die Warteschlange. Page
-- selbst wird dabei nicht beschrieben (AFTER-Trigger, eigene Tabelle).
-- pg_restore legt Trigger erst nach den Daten an; Warteschlange und
-- Chunks kommen dort aus demselben Snapshot.
CREATE FUNCTION dokunc_ai_index_enqueue() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "AiIndexQueue" ("pageId") VALUES (NEW."id")
    ON CONFLICT ("pageId") DO NOTHING;
  RETURN NULL;
END
$$;

CREATE TRIGGER "Page_aiIndexQueue_insert"
  AFTER INSERT ON "Page"
  FOR EACH ROW EXECUTE FUNCTION dokunc_ai_index_enqueue();

-- Nur bei echter Aenderung: der Collab-Server schreibt textContent bei
-- jedem Speicherlauf mit, auch unveraendert.
CREATE TRIGGER "Page_aiIndexQueue_update"
  AFTER UPDATE OF "textContent" ON "Page"
  FOR EACH ROW
  WHEN (OLD."textContent" IS DISTINCT FROM NEW."textContent")
  EXECUTE FUNCTION dokunc_ai_index_enqueue();
