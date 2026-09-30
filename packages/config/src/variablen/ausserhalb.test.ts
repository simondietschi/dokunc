import { describe, expect, it } from "vitest";
import type { Variable } from "../variable";
import { AUSSERHALB_VARIABLEN } from "./ausserhalb";

/**
 * Regeln der Variablen, die nur Docker Compose oder Skripte lesen. Beim
 * Start prueft sie niemand; die Parser halten fest, was Docker, Compose
 * und prisma.config.ts annehmen, fuer die Konfigurationsreferenz.
 */

function variable(name: string): Variable {
  const v = AUSSERHALB_VARIABLEN.find((x) => x.name === name);
  if (!v) throw new Error(`${name} fehlt`);
  return v;
}

function parse(name: string, roh: string | undefined) {
  return variable(name).parse(roh, {});
}

describe("LOG_MAX_SIZE", () => {
  // Docker liest max-size wie go-units FromHumanSize (Einheit dezimal,
  // "i" und "b" duerfen folgen) und verlangt mehr als 0 Byte.
  it.each([
    [undefined, "10m"],
    ["", "10m"],
    [" 10m ", "10m"],
    ["500k", "500k"],
    ["1g", "1g"],
    ["1.5g", "1.5g"],
    ["10MB", "10MB"],
    ["10 MiB", "10 MiB"],
    ["1048576", "1048576"],
  ])("nimmt %j als %j", (roh, wert) => {
    expect(parse("LOG_MAX_SIZE", roh)).toEqual({ ok: true, wert });
  });

  it.each(["10x", "m", "-1m", "0", "0m", "10 m b", "1,5g", "zehn"])("weist %j ab", (roh) => {
    expect(parse("LOG_MAX_SIZE", roh)).toEqual({
      ok: false,
      fehler: `LOG_MAX_SIZE erwartet eine Grösse über 0 wie 10m (Zahl, danach k, m oder g): "${roh}"`,
    });
  });
});

describe("LOG_MAX_FILE", () => {
  // Docker liest max-file mit strconv.Atoi und verlangt mindestens 1.
  it.each([
    [undefined, 5],
    ["", 5],
    ["1", 1],
    [" 7 ", 7],
    ["+3", 3],
    ["010", 10],
    ["1000", 1000],
  ])("nimmt %j als %j", (roh, wert) => {
    expect(parse("LOG_MAX_FILE", roh)).toEqual({ ok: true, wert });
  });

  it.each(["0", "-1", "1.5", "fünf", "5 Dateien"])("weist %j ab", (roh) => {
    expect(parse("LOG_MAX_FILE", roh)).toEqual({
      ok: false,
      fehler: `LOG_MAX_FILE erwartet eine ganze Zahl ab 1: "${roh}"`,
    });
  });
});

describe("COMPOSE_PROJECT_NAME", () => {
  // Regel von Compose, wie scripts/projektname.sh sie prueft; leer heisst
  // "name: dokunc" aus docker-compose.yml.
  it.each([
    [undefined, null],
    ["", null],
    [" ", null],
    ["dokunc", "dokunc"],
    ["wiki-test", "wiki-test"],
    ["wiki_2", "wiki_2"],
    ["1wiki", "1wiki"],
    [" wikialt ", "wikialt"],
  ])("nimmt %j als %j", (roh, wert) => {
    expect(parse("COMPOSE_PROJECT_NAME", roh)).toEqual({ ok: true, wert });
  });

  it.each(["Wiki", "_wiki", "-wiki", "wiki alt", "wiki.alt", "wikiä"])("weist %j ab", (roh) => {
    expect(parse("COMPOSE_PROJECT_NAME", roh)).toEqual({
      ok: false,
      fehler: `COMPOSE_PROJECT_NAME erlaubt nur a-z, 0-9, _ und -, vorne einen Buchstaben oder eine Ziffer: "${roh}"`,
    });
  });
});

describe("SHADOW_DATABASE_URL", () => {
  // Dass sie nicht die Datenbank von DATABASE_URL ist, prueft
  // prisma.config.ts (apps/web/src/migrationen.test.ts).
  it.each([
    [undefined, null],
    ["", null],
    ["postgresql://dokunc:dokunc@localhost:5432/dokunc_schatten", "postgresql://dokunc:dokunc@localhost:5432/dokunc_schatten"],
    [" postgres://u:p@db:5432/schatten ", "postgres://u:p@db:5432/schatten"],
  ])("nimmt %j", (roh, wert) => {
    expect(parse("SHADOW_DATABASE_URL", roh)).toEqual({ ok: true, wert });
  });

  it.each([
    "mysql://root:geheim@localhost/schatten",
    "localhost:5432/schatten",
    "postgresql://root:geheim@localhost:5432/",
  ])("weist %j ab, ohne den Wert zu nennen", (roh) => {
    const r = parse("SHADOW_DATABASE_URL", roh);
    expect(r).toEqual({
      ok: false,
      fehler: "SHADOW_DATABASE_URL erwartet eine PostgreSQL-URL mit Datenbankname (postgresql://…/name).",
    });
  });
});
