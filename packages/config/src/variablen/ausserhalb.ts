import { defineVariable, type Variable } from "../variable";

/** Keine Laufzeitpruefung: der Wert geht so, wie er ist, an das Werkzeug. */
const unveraendert = (roh: string | undefined) => ({ ok: true as const, wert: roh ?? null });

/**
 * Variablen, die nur Docker Compose, der Proxy (Caddy) oder Skripte
 * lesen. Keine Pruefung beim Start der Server; die Deklaration haelt
 * Beschreibung, Vorgabe und `geheim` fest und laesst den Gleichlauftest
 * sie in .env.example finden. Nach `name` sortiert.
 */
export const AUSSERHALB_VARIABLEN: readonly Variable[] = [
  defineVariable({
    name: "SHADOW_DATABASE_URL",
    dienste: ["skript"],
    beschreibung:
      "Empty database that prisma migrate diff and prisma migrate dev may wipe; used by pnpm --filter @dokunc/db migrate:check (development and CI). Never the application database: prisma.config.ts refuses the database of DATABASE_URL.",
    geheim: true,
    parse: unveraendert,
  }),
];
