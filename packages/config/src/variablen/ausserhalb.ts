import type { Ergebnis } from "../ergebnis";
import { defineVariable, type Variable } from "../variable";

/*
 * Die Parser halten fest, was Docker, Compose und prisma.config.ts
 * annehmen. Beim Start der Server laufen sie nicht (niemand dort liest
 * diese Werte); sie sind die Regel fuer die Konfigurationsreferenz und
 * fuer Pruefungen vor dem Start.
 */

/**
 * Groesse wie Docker sie fuer max-size liest (go-units FromHumanSize):
 * Zahl, optional ein Leerzeichen, Einheit k, m, g, t oder p (dezimal),
 * danach optional "i" und "b". Docker verlangt mehr als 0 Byte.
 */
const DOCKER_GROESSE = /^(\d+(?:\.\d+)?) ?(?:[kmgtp])?i?b?$/i;

function logGroesse(roh: string | undefined): Ergebnis<string> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: "10m" };
  const m = DOCKER_GROESSE.exec(text);
  if (!m || !(Number(m[1]) > 0)) {
    return {
      ok: false,
      fehler: `LOG_MAX_SIZE erwartet eine Grösse über 0 wie 10m (Zahl, danach k, m oder g): "${roh}"`,
    };
  }
  return { ok: true, wert: text };
}

/** Anzahl wie Docker sie fuer max-file liest (strconv.Atoi), mindestens 1. */
function logDateien(roh: string | undefined): Ergebnis<number> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: 5 };
  const zahl = /^\+?\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(zahl) || zahl < 1) {
    return { ok: false, fehler: `LOG_MAX_FILE erwartet eine ganze Zahl ab 1: "${roh}"` };
  }
  return { ok: true, wert: zahl };
}

/**
 * Projektname nach der Regel von Compose (wie scripts/projektname.sh).
 * Leer: nicht gesetzt, es gilt "name:" aus docker-compose.yml.
 */
function projektName(roh: string | undefined): Ergebnis<string | null> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: null };
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(text)) {
    return {
      ok: false,
      fehler: `COMPOSE_PROJECT_NAME erlaubt nur a-z, 0-9, _ und -, vorne einen Buchstaben oder eine Ziffer: "${roh}"`,
    };
  }
  return { ok: true, wert: text };
}

/**
 * PostgreSQL-URL mit Datenbankname. Geheim: die Meldung nennt den Wert
 * nicht. Dass es nicht die Datenbank von DATABASE_URL ist, prueft
 * prisma.config.ts, bevor Prisma etwas leert.
 */
function schattenDatenbank(roh: string | undefined): Ergebnis<string | null> {
  const text = (roh ?? "").trim();
  if (text === "") return { ok: true, wert: null };
  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol) || url.pathname.length < 2) {
    return {
      ok: false,
      fehler: "SHADOW_DATABASE_URL erwartet eine PostgreSQL-URL mit Datenbankname (postgresql://…/name).",
    };
  }
  return { ok: true, wert: text };
}

/**
 * Variablen, die nur Docker Compose, der Proxy (Caddy) oder Skripte
 * lesen. Keine Pruefung beim Start der Server; die Deklaration haelt
 * Beschreibung, Vorgabe, Regel und `geheim` fest und laesst den
 * Gleichlauftest sie in .env.example finden. Nach `name` sortiert.
 */
export const AUSSERHALB_VARIABLEN: readonly Variable[] = [
  defineVariable({
    name: "COMPOSE_PROJECT_NAME",
    dienste: ["compose"],
    beschreibung:
      "Docker Compose project name; volumes are named <project>_<volume>. docker-compose.yml sets dokunc. Set it only to keep the name of an installation from before the fixed name (scripts/projektname.sh --festschreiben); another name starts a new, empty instance.",
    vorgabe: "dokunc (name: in docker-compose.yml)",
    parse: projektName,
  }),
  defineVariable({
    name: "LOG_MAX_FILE",
    dienste: ["compose"],
    beschreibung:
      "Number of log files Docker keeps per container (json-file log driver, all services). A whole number of at least 1; Docker refuses to create the container otherwise.",
    vorgabe: "5",
    parse: logDateien,
  }),
  defineVariable({
    name: "LOG_MAX_SIZE",
    dienste: ["compose"],
    beschreibung:
      "Maximum size of one log file per container before Docker rotates it (json-file log driver, all services), for example 10m; units k, m or g. Docker refuses to create the container with an invalid size.",
    vorgabe: "10m",
    parse: logGroesse,
  }),
  defineVariable({
    name: "SHADOW_DATABASE_URL",
    dienste: ["skript"],
    beschreibung:
      "Empty database that prisma migrate diff and prisma migrate dev may wipe; used by pnpm --filter @dokunc/db migrate:check (development and CI). Never the application database: prisma.config.ts refuses the database of DATABASE_URL.",
    geheim: true,
    parse: schattenDatenbank,
  }),
];
