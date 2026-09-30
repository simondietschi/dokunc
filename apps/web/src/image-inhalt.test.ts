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
 *
 * Und: die Stufe runner entfernt npm, npx und corepack, und nichts, was im
 * Container laeuft, ruft sie auf. Das npm des Basis-Images brachte eigene
 * Abhaengigkeiten mit, deren Luecken der Image-Scan meldete, obwohl dokunc
 * sie nie laedt. Am gebauten Image prueft dasselbe der CI-Job docker
 * ("Kein npm im Image").
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

/**
 * Zeilen, eine Fortsetzung (\ am Zeilenende) an die vorige angehaengt.
 * Mit `ohneKommentare` entfallen Zeilen, die mit # beginnen, auch mitten
 * in einer Fortsetzung; so liest Docker das Dockerfile.
 */
export function logischeZeilen(text: string, ohneKommentare = false): string[] {
  const zeilen: string[] = [];
  let offen: string | null = null;
  for (const roh of text.split("\n")) {
    const z = roh.trim();
    if (ohneKommentare && z.startsWith("#")) continue;
    const weiter = z.endsWith("\\");
    const teil = weiter ? z.slice(0, -1).trim() : z;
    offen = offen === null ? teil : `${offen} ${teil}`;
    if (weiter) continue;
    zeilen.push(offen);
    offen = null;
  }
  if (offen !== null) zeilen.push(offen);
  return zeilen;
}

/**
 * Anweisungen je Stufe des Dockerfile, Fortsetzungszeilen (\) zu einer
 * Anweisung zusammengefuegt, ohne Kommentare und Leerzeilen.
 */
export function stufenAnweisungen(text: string): Map<string, string[]> {
  const stufen = new Map<string, string[]>();
  let aktuell = "";
  for (const a of logischeZeilen(text, true)) {
    if (a === "") continue;
    const from = /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(a);
    if (from) {
      aktuell = from[1];
      stufen.set(aktuell, []);
    } else if (aktuell) {
      stufen.get(aktuell)?.push(a);
    }
  }
  return stufen;
}

/** Text ohne Zeilen, die mit # beginnen (Shell, YAML, Dockerfile). */
function ohneKommentare(text: string): string {
  return text
    .split("\n")
    .filter((z) => !z.trim().startsWith("#"))
    .join("\n");
}

/** Aufruf von npm, npx oder corepack; pnpm und npmjs.org zaehlen nicht. */
const NPM = /\b(npm|npx|corepack)\b/;

/**
 * Befehle, die npm, npx oder corepack im Container app ausfuehren, auch
 * wenn der Befehl mit \ ueber mehrere Zeilen laeuft.
 */
export function npmImAppContainer(text: string): string[] {
  return logischeZeilen(text).filter(
    (z) => /\bdocker[ -]compose\b.*\b(exec|run)\b.*\bapp\b/.test(z) && NPM.test(z),
  );
}

const dockerignore = muster(lesen(".dockerignore"));
const stufen = stufenAnweisungen(lesen("Dockerfile"));

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
  const pakete = ["apps", "packages"].flatMap((ordner) =>
    readdirSync(join(ROOT, ordner))
      .map((name) => `${ordner}/${name}/package.json`)
      .filter((p) => existsSync(join(ROOT, p))),
  );

  it.each(["deps", "deps-prod"])("kopiert in %s jedes Workspace-Paket", (stufe) => {
    const kopien = (stufen.get(stufe) ?? []).filter((a) => /^COPY\s/i.test(a));
    expect(kopien.length, `Stufe ${stufe} fehlt`).toBeGreaterThan(0);
    const fehlt = pakete.filter((p) => !kopien.some((z) => z.split(/\s+/).includes(p)));
    expect(fehlt).toEqual([]);
  });
});

describe("Laufzeit-Image ohne npm", () => {
  const runner = stufen.get("runner") ?? [];
  const pfade = [
    "/usr/local/lib/node_modules/npm",
    "/usr/local/bin/npm",
    "/usr/local/bin/npx",
    "/usr/local/lib/node_modules/corepack",
    "/usr/local/bin/corepack",
  ];
  const rm = runner.findIndex(
    (a) => /^RUN\s+rm\s+-rf\s/.test(a) && pfade.every((p) => a.split(/\s+/).includes(p)),
  );

  it("entfernt npm, npx und corepack in der Stufe runner", () => {
    expect(runner.length, "Stufe runner fehlt").toBeGreaterThan(0);
    expect(rm, `RUN rm -rf ${pfade.join(" ")} fehlt in runner`).toBeGreaterThanOrEqual(0);
  });

  it("holt sie danach weder per Befehl noch per Kopie zurueck", () => {
    const danach = runner.slice(rm + 1);
    expect(danach.filter((a) => NPM.test(a))).toEqual([]);
    expect(danach.filter((a) => /--from=\S+(\s+--\S+)*\s+\/usr\/local\b/.test(a))).toEqual([]);
  });

  // Was im Container laeuft: Start, Einstieg, Healthcheck (Compose) und
  // die Befehle, die backup.sh und restore.sh dort ausfuehren.
  const skripte = (datei: string): Record<string, string> =>
    (JSON.parse(lesen(datei)) as { scripts: Record<string, string> }).scripts;
  const compose = readdirSync(ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
  const laufzeit: [string, string][] = [
    [
      "CMD und ENTRYPOINT der Stufe runner",
      runner.filter((a) => /^(CMD|ENTRYPOINT)\s/i.test(a)).join("\n"),
    ],
    ...["scripts/docker-entrypoint.sh", "scripts/backup.sh", "scripts/restore.sh", ...compose].map(
      (f): [string, string] => [f, ohneKommentare(lesen(f))],
    ),
    [
      "pnpm start und migrate:deploy",
      [
        skripte("package.json").start,
        skripte("apps/web/package.json").start,
        skripte("apps/collab/package.json").start,
        skripte("packages/db/package.json")["migrate:deploy"],
      ].join("\n"),
    ],
  ];

  it.each(laufzeit)("%s ruft weder npm noch npx auf", (_, text) => {
    expect(text.trim()).not.toBe("");
    expect(text.split("\n").filter((z) => NPM.test(z))).toEqual([]);
  });

  it("die Anleitungen fuehren npm und npx nicht im Container der App aus", () => {
    const docs = readdirSync(join(ROOT, "docs"), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".md"))
      .map((f) => `docs/${f}`);
    const treffer = ["README.md", ...docs].flatMap((f) =>
      npmImAppContainer(lesen(f)).map((z) => `${f}: ${z}`),
    );
    expect(treffer).toEqual([]);
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

  it("liest die Anweisungen je Stufe", () => {
    const text = [
      "# syntax=docker/dockerfile:1",
      "FROM node AS base",
      "RUN a \\",
      "  # Kommentar in der Fortsetzung",
      "  && b",
      "",
      "FROM base AS runner",
      "COPY . .",
      "CMD [\"sh\"]",
    ].join("\n");
    expect([...stufenAnweisungen(text)]).toEqual([
      ["base", ["RUN a && b"]],
      ["runner", ["COPY . .", 'CMD ["sh"]']],
    ]);
  });

  it("erkennt npm, npx und corepack, nicht pnpm", () => {
    expect(NPM.test("npm install -g pnpm@11")).toBe(true);
    expect(NPM.test("docker compose exec app npx prisma studio")).toBe(true);
    expect(NPM.test("corepack enable")).toBe(true);
    expect(NPM.test("pnpm --filter @dokunc/db migrate:deploy && exec pnpm start")).toBe(false);
    expect(NPM.test("pnpx prisma")).toBe(false);
    expect(NPM.test("fetch('https://registry.npmjs.org/')")).toBe(false);
  });

  it("findet npm im Container app auch in Befehlen ueber mehrere Zeilen", () => {
    expect(npmImAppContainer("docker compose exec app \\\n  npx prisma studio")).toEqual([
      "docker compose exec app npx prisma studio",
    ]);
    expect(npmImAppContainer("    docker compose exec -T app npm run migrate")).toHaveLength(1);
    expect(
      npmImAppContainer("docker compose -f docker-compose.yml run --rm app \\\n  npm ls"),
    ).toHaveLength(1);
    expect(
      npmImAppContainer("docker compose exec app pnpm --filter @dokunc/db exec prisma migrate status"),
    ).toEqual([]);
    expect(npmImAppContainer("docker compose exec app \\\n  pnpm start\nnpm ls")).toEqual([]);
  });

  it("liest den markierten Block", () => {
    const text = "a\n# Geheimnisse (Anfang): x\n# Kommentar\nb\n\n!c\n# Geheimnisse (Ende)\nd";
    expect(geheimnisBlock(text)).toEqual(["b", "!c"]);
    expect(geheimnisBlock("a\nb")).toBeNull();
  });
});
