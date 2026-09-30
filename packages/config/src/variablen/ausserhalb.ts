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
    name: "COMPOSE_PROJECT_NAME",
    dienste: ["compose"],
    beschreibung:
      "Docker Compose project name; volumes are named <project>_<volume>. docker-compose.yml sets dokunc. Set it only to keep the name of an installation from before the fixed name (scripts/projektname.sh --festschreiben); another name starts a new, empty instance.",
    vorgabe: "dokunc (name: in docker-compose.yml)",
    parse: unveraendert,
  }),
  defineVariable({
    name: "LOG_MAX_FILE",
    dienste: ["compose"],
    beschreibung:
      "Number of log files Docker keeps per container (json-file log driver, all services). A whole number of at least 1; Docker refuses to create the container otherwise.",
    vorgabe: "5",
    parse: unveraendert,
  }),
  defineVariable({
    name: "LOG_MAX_SIZE",
    dienste: ["compose"],
    beschreibung:
      "Maximum size of one log file per container before Docker rotates it (json-file log driver, all services), for example 10m; units k, m or g. Docker refuses to create the container with an invalid size.",
    vorgabe: "10m",
    parse: unveraendert,
  }),
  defineVariable({
    name: "SHADOW_DATABASE_URL",
    dienste: ["skript"],
    beschreibung:
      "Empty database that prisma migrate diff and prisma migrate dev may wipe; used by pnpm --filter @dokunc/db migrate:check (development and CI). Never the application database: prisma.config.ts refuses the database of DATABASE_URL.",
    geheim: true,
    parse: unveraendert,
  }),
];
