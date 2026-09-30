import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Was ins Docker-Image gelangt.
 *
 * Build- und Runner-Stufe kopieren mit `COPY . .` den ganzen Kontext;
 * im Laufzeit-Image landet also alles, was .dockerignore nicht
 * ausschliesst. Dort stehen deshalb dieselben Geheimnismuster wie im
 * markierten Block der .gitignore, zusaetzlich mit **\/ davor: Docker
 * wendet ein Muster ohne Schraegstrich nur im Wurzelordner an, Git in
 * jedem Ordner.
 *
 * Dazu: jedes Workspace-Paket wird in den Abhaengigkeitsstufen kopiert.
 * Fehlt eines, installiert pnpm dessen Abhaengigkeiten nicht, und der
 * Container startet ohne sie.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function lesen(datei: string): string {
  return readFileSync(join(ROOT, datei), "utf8");
}

/** Muster einer Ignore-Datei in Reihenfolge, ohne Kommentare und Leerzeilen. */
export function muster(text: string): string[] {
  return text
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z !== "" && !z.startsWith("#"));
}

/** Die Muster zwischen "# Geheimnisse (Anfang)" und "# Geheimnisse (Ende)". */
export function geheimnisBlock(gitignore: string): string[] | null {
  const zeilen = gitignore.split("\n");
  const anfang = zeilen.findIndex((z) => z.startsWith("# Geheimnisse (Anfang)"));
  const ende = zeilen.findIndex((z) => z.startsWith("# Geheimnisse (Ende)"));
  if (anfang < 0 || ende < anfang) return null;
  return muster(zeilen.slice(anfang + 1, ende).join("\n"));
}

function alsRegex(m: string): RegExp {
  let re = "";
  for (let i = 0; i < m.length; i += 1) {
    const c = m[i];
    if (m.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (m.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * Schliesst .dockerignore den Pfad aus? Wie Docker: Muster gelten ab der
 * Wurzel des Kontexts, ein Muster trifft auch jeden Pfad unter einem
 * getroffenen Ordner, und das letzte zutreffende Muster entscheidet
 * (`!` nimmt wieder auf).
 */
export function ausgeschlossen(liste: readonly string[], pfad: string): boolean {
  const teile = pfad.split("/");
  const mitEltern = teile.map((_, i) => teile.slice(0, i + 1).join("/"));
  let aus = false;
  for (const roh of liste) {
    const wieder = roh.startsWith("!");
    const m = (wieder ? roh.slice(1) : roh).replace(/^\//, "").replace(/\/$/, "");
    const re = alsRegex(m);
    if (mitEltern.some((p) => re.test(p))) aus = !wieder;
  }
  return aus;
}

const dockerignore = muster(lesen(".dockerignore"));

describe(".dockerignore haelt Geheimnisse aus dem Image", () => {
  const block = geheimnisBlock(lesen(".gitignore"));

  it("findet in .gitignore den markierten Block mit den Pflichtmustern", () => {
    expect(block, "Block '# Geheimnisse (Anfang)' bis '# Geheimnisse (Ende)' fehlt in .gitignore").not.toBeNull();
    expect(block).toEqual(
      expect.arrayContaining([".env", ".env.*", "!.env.example", "*.rdb", "app_secret"]),
    );
  });

  it("fuehrt jedes Muster des Blocks, ohne Schraegstrich auch fuer Unterordner", () => {
    const fehlt: string[] = [];
    for (const m of block ?? []) {
      if (m.startsWith("!")) continue;
      if (!dockerignore.includes(m)) fehlt.push(m);
      if (!m.includes("/") && !dockerignore.includes(`**/${m}`)) fehlt.push(`**/${m}`);
    }
    expect(fehlt).toEqual([]);
  });

  it("nimmt Ausnahmen des Blocks nach den Mustern wieder auf, die sie treffen", () => {
    for (const m of (block ?? []).filter((x) => x.startsWith("!"))) {
      expect(dockerignore, m).toContain(m);
      expect(ausgeschlossen(dockerignore, m.slice(1)), m).toBe(false);
    }
  });

  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "apps/web/.env",
    "apps/web/.env.local",
    "apps/web/.env.production.local",
    "dump.rdb",
    "apps/collab/dump.rdb",
    "app_secret",
    "scripts/app_secret",
    "docker-compose.override.yml",
    ".claude/settings.local.json",
    ".github/workflows/ci.yml",
  ])("laesst %s nicht in den Kontext", (pfad) => {
    expect(ausgeschlossen(dockerignore, pfad)).toBe(true);
  });

  it.each([
    ".env.example",
    "Dockerfile",
    "package.json",
    "scripts/docker-entrypoint.sh",
    "apps/web/src/instrumentation.ts",
    "apps/collab/src/server.ts",
    "packages/config/src/index.ts",
    "packages/db/prisma/schema.prisma",
  ])("nimmt %s mit", (pfad) => {
    expect(ausgeschlossen(dockerignore, pfad)).toBe(false);
  });
});

describe("Abhaengigkeitsstufen des Dockerfile", () => {
  const stufen = new Map<string, string[]>();
  let aktuell = "";
  for (const z of lesen("Dockerfile").split("\n")) {
    const from = /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(z);
    if (from) {
      aktuell = from[1];
      stufen.set(aktuell, []);
    } else if (aktuell && /^COPY\s/i.test(z)) {
      stufen.get(aktuell)?.push(z);
    }
  }

  const pakete = ["apps", "packages"].flatMap((ordner) =>
    readdirSync(join(ROOT, ordner))
      .map((name) => `${ordner}/${name}/package.json`)
      .filter((p) => existsSync(join(ROOT, p))),
  );

  it.each(["deps", "deps-prod"])("kopiert in %s jedes Workspace-Paket", (stufe) => {
    const kopien = stufen.get(stufe) ?? [];
    expect(kopien.length, `Stufe ${stufe} fehlt`).toBeGreaterThan(0);
    const fehlt = pakete.filter((p) => !kopien.some((z) => z.split(/\s+/).includes(p)));
    expect(fehlt).toEqual([]);
  });
});

describe("Hilfen", () => {
  it("wertet Muster wie Docker aus", () => {
    expect(ausgeschlossen(["*.rdb"], "dump.rdb")).toBe(true);
    expect(ausgeschlossen(["*.rdb"], "a/dump.rdb")).toBe(false);
    expect(ausgeschlossen(["**/*.rdb"], "a/b/dump.rdb")).toBe(true);
    expect(ausgeschlossen([".claude"], ".claude/x/y")).toBe(true);
    expect(ausgeschlossen([".env.*", "!.env.example"], ".env.example")).toBe(false);
    expect(ausgeschlossen(["!.env.example", ".env.*"], ".env.example")).toBe(true);
  });

  it("liest den markierten Block", () => {
    const text = "a\n# Geheimnisse (Anfang): x\n# Kommentar\nb\n\n!c\n# Geheimnisse (Ende)\nd";
    expect(geheimnisBlock(text)).toEqual(["b", "!c"]);
    expect(geheimnisBlock("a\nb")).toBeNull();
  });
});
