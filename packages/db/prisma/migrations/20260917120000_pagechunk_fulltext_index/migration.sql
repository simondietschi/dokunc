-- Volltext-GIN-Index über den Text der Chunks.
--
-- Der Rückgriff der KI ("Frag dein Wiki" ohne VOYAGE_API_KEY) filtert in
-- lib/retrieval.ts mit `to_tsvector('simple', c.text) @@ plainto_tsquery(...)`
-- und rankt mit ts_rank über denselben Ausdruck. Ohne Index dazu liest
-- Postgres bei jeder Frage die ganze Tabelle und berechnet den tsvector
-- pro Zeile neu — bei einem gewachsenen Wiki ist das der teuerste Teil
-- der Anfrage, und sie steht hinter einer Bremse von 20 Fragen pro Stunde
-- und Konto, nicht hinter einer Begrenzung der Laufzeit.
--
-- Der Ausdruck muss ZEICHENGLEICH zu dem in der Abfrage sein, sonst
-- greift der Index nicht. Gegenstück für "Page": Migration
-- 20260519140000_page_fulltext_index.
CREATE INDEX IF NOT EXISTS "PageChunk_fulltext_idx"
ON "PageChunk"
USING GIN (to_tsvector('simple', text));
