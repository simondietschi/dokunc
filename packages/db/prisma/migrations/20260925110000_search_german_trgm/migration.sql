-- Suche (Punkt 8): Titel per Trigramm, Inhalt ueber eine gespeicherte
-- tsvector-Spalte mit deutschen Wortformen und unveraenderten Woertern.
--
-- Warum eine Spalte und kein Ausdrucksindex: ts_rank braucht den Vektor
-- jeder passenden Seite; aus einem Ausdrucksindex liest Postgres ihn
-- nicht, es berechnet ihn neu. Bei einem haeufigen Wort oder einem
-- kurzen Praefix waehrend des Tippens sind das alle Seiten.
--
-- Warum Trigger und keine GENERATED-Spalte: Prisma liest den
-- Generierungsausdruck als Default und meldet sonst Drift.
--
-- pg_trgm ist eine trusted extension: der Besitzer der Datenbank darf
-- sie anlegen. Bei einer fremd verwalteten Datenbank muss sie vorher
-- angelegt sein (README).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Eine Stelle fuer den Suchvektor. Deutsche Staemme finden andere
-- Wortformen, 'simple' behaelt Woerter, die der Stemmer verstuemmelt
-- oder als Stoppwort verwirft, und traegt Wortanfaenge beim Tippen.
-- Titel mit Gewicht A. Ein tsvector darf 1 MB nicht ueberschreiten:
-- zuerst 250 000 Zeichen Text; reicht das nicht (viele verschiedene
-- Woerter aus Zeichen mit 4 Byte), nur 'simple' ueber 100 000 Zeichen,
-- im aeussersten Fall nur der Titel. So scheitert weder das Speichern
-- einer Seite noch diese Migration.
CREATE FUNCTION dokunc_page_search_vector(title text, body text)
RETURNS tsvector
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  BEGIN
    RETURN setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A')
        || to_tsvector('german'::regconfig, left(coalesce(body, ''), 250000))
        || setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A')
        || to_tsvector('simple'::regconfig, left(coalesce(body, ''), 250000));
  EXCEPTION WHEN program_limit_exceeded THEN
    BEGIN
      RETURN setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A')
          || to_tsvector('simple'::regconfig, left(coalesce(body, ''), 100000));
    EXCEPTION WHEN program_limit_exceeded THEN
      RETURN setweight(to_tsvector('simple'::regconfig, left(coalesce(title, ''), 1000)), 'A');
    END;
  END;
END
$$;

CREATE FUNCTION dokunc_page_search_vector_set() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" := dokunc_page_search_vector(NEW.title, NEW."textContent");
  RETURN NEW;
END
$$;

-- Der alte Ausdrucksindex ('simple', Migration 20260519140000) wird von
-- keiner Abfrage mehr benutzt; er kostete bei jedem Speichern eine
-- weitere Berechnung.
DROP INDEX IF EXISTS "Page_fulltext_idx";

-- AlterTable
ALTER TABLE "Page" ADD COLUMN "searchVector" tsvector;

-- Bestand fuellen. Beruehrt updatedAt nicht (das setzt nur Prisma) und
-- loest den Trigger aus Punkt 7 nicht aus (der hoert nur auf textContent).
UPDATE "Page" SET "searchVector" = dokunc_page_search_vector(title, "textContent");

CREATE TRIGGER "Page_searchVector_insert"
  BEFORE INSERT ON "Page"
  FOR EACH ROW EXECUTE FUNCTION dokunc_page_search_vector_set();

-- Nur bei echter Aenderung: der Collab-Server schreibt textContent bei
-- jedem Speicherlauf mit, auch unveraendert.
CREATE TRIGGER "Page_searchVector_update"
  BEFORE UPDATE OF title, "textContent" ON "Page"
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title
        OR OLD."textContent" IS DISTINCT FROM NEW."textContent")
  EXECUTE FUNCTION dokunc_page_search_vector_set();

-- CreateIndex
CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "Page_title_trgm_idx" ON "Page" USING GIN ("title" gin_trgm_ops);

-- Rueckgriff der KI ohne Voyage (lib/retrieval.ts): dieselbe Sprache.
-- Der Ausdruck muss ZEICHENGLEICH zu dem in der Abfrage sein
-- (to_tsvector('german', c.text)), sonst greift der Index nicht.
DROP INDEX IF EXISTS "PageChunk_fulltext_idx";
CREATE INDEX "PageChunk_fulltext_german_idx"
  ON "PageChunk" USING GIN (to_tsvector('german'::regconfig, text));
