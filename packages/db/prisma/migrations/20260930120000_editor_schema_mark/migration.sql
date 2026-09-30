-- Hochwassermarke des Editor-Schemas. Jeder Collab-Server hebt sie beim
-- Start auf seine eigene Version (nie herunter); eine Instanz mit
-- kleinerer Version nimmt danach keine Editoren mehr an. Bestehende
-- Zeilen bekommen 0 (noch keine Marke), der erste Start setzt sie.
ALTER TABLE "InstanceState"
  ADD COLUMN "editorSchemaVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "editorSchemaHash" TEXT,
  ADD CONSTRAINT "InstanceState_editorSchemaVersion_range"
    CHECK ("editorSchemaVersion" >= 0),
  -- Das Format von schemaHash (packages/editor/src/schema-hash.ts).
  ADD CONSTRAINT "InstanceState_editorSchemaHash_format"
    CHECK ("editorSchemaHash" IS NULL OR "editorSchemaHash" ~ '^[0-9a-f]{16}$');
