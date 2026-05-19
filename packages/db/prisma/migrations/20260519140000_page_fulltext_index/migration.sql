-- Volltext-GIN-Index für die Suche über Titel + Inhalt
CREATE INDEX IF NOT EXISTS "Page_fulltext_idx"
ON "Page"
USING GIN (
  to_tsvector(
    'simple',
    coalesce(title, '') || ' ' || coalesce("textContent", '')
  )
);
