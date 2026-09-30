import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { MAX_LAENGE, pruefeTitel, TYPEN } from "../../../.github/scripts/pr-title.mjs";

/**
 * Konventionen fuer Beitraege (CONTRIBUTING.md): die Titelpruefung fuer
 * Pull-Requests (.github/scripts/pr-title.mjs), ihr Workflow, die Titel,
 * die Dependabot erzeugt, und keine internen Planbezuege in versionierten
 * Dateien.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKRIPT = join(ROOT, ".github/scripts/pr-title.mjs");
const DEPENDABOT = "dependabot[bot]";

function lesen(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

type Schritt = { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Workflow = {
  on: Record<string, { types?: string[] } | null>;
  permissions?: unknown;
  jobs: Record<string, { steps?: Schritt[] }>;
};

/**
 * Interne Planbezuege: Kennungen aus Arbeitsplaenen und Pruefrunden, die
 * ausserhalb nichts bedeuten ("Punkt 10", Befundnummern, Stufen,
 * Etappen, Kennungen von Luecken und Entscheidungen). Geprueft werden
 * Pfad und Zeilen jeder versionierten Datei; `nur` beschraenkt eine
 * Regel auf passende Pfade.
 */
const PLANBEZUEGE: { art: string; muster: RegExp; nur?: RegExp }[] = [
  { art: "plan item", muster: /\b(?:Punkte?|Folgepunkte?) (?:\d+|[A-Z])\b/ },
  { art: "finding number", muster: /\b[BKW]\d{1,3}\b|\bKritik \d+/ },
  // Auch nach "_" oder "-" im Pfad ("..._stage1_...", "e2e/stage3-...")
  { art: "plan stage", muster: /\bStufe \d\b|(?<![A-Za-z])stage ?\d/i },
  { art: "plan stage", muster: /\bE(?:[1-9]|1[0-3])[ab]\b|\b(?:Etappe|Welle) \d+\b/ },
  // In Fliesstext (Markdown, YAML) auch die blosse Etappe; im Code ist
  // "E1" ein gewoehnlicher Bezeichner (Personen in Tests).
  { art: "plan stage", muster: /\bE(?:[1-9]|1[0-3])\b/, nur: /\.(?:md|ya?ml)$/ },
  // Kennungen von Luecken, wie man sie zitiert: in Backticks, mit einem
  // der haeufigen Praefixe. Bei Praefixen, die auch gewoehnliche Woerter
  // sind (editor, ui, api, ki, int), erst ab zwei Bindestrichen, damit
  // `editor-content` oder `api-key` nicht anschlagen. Das Muster faengt
  // auch Kennungen, die spaeter hinzukommen; die heutigen erkennt
  // PLAN_KENNUNGEN alle, auch einteilige und solche ohne Praefix.
  {
    art: "plan id",
    muster:
      /`(?:(?:ident|struktur|betr|plat|qa|cmp)-[a-z0-9]+|(?:editor|ui|api|ki|int)-[a-z0-9]+-[a-z0-9]+)(?:-[a-z0-9]+)*`/,
  },
  // Entscheidungen ("D" mit Nummer, auch mit Buchstaben) in Klammern,
  // Backticks oder nach "Entscheidung"/"decision"; frei im Text waere
  // "FF D8 FF" (JPEG) ein Treffer, ebenso Zellbezuege wie "(D1:D5)".
  {
    art: "decision id",
    muster: /(?:[(`[]|\b(?:Entscheidung|[Dd]ecision) )D(?:[1-9]|[1-9]\d)[a-z]?(?![\w.:])/,
  },
];

/**
 * Kennungen aller Luecken des Arbeitsplans, nur als Pruefsumme, damit sie
 * selbst nicht im Repository stehen: die ersten 12 Hexziffern von
 * SHA-256 ueber die Kennung, sortiert. Neue Kennung:
 *   printf %s <kennung> | sha256sum | cut -c1-12
 * Geprueft wird jedes Wort mit Bindestrich in Pfad und Zeilen (getrennt
 * an allem ausser Buchstaben, Ziffern und "-"), genau so geschrieben wie
 * im Plan, und jedes Wort in Backticks: einteilige Kennungen sind auch
 * gewoehnliche Woerter.
 */
const PLAN_KENNUNGEN_LISTE = `
  0002f6ae5f30 006dd6528484 00eddc6598a3 02c2cbdebd9a 02cb8ebe92e4 03b91bf21bbc 0410e62e7e8c 055a29ee27a8 059b8f829b4d
  07c3b7e80cd0 083cdb307e10 086a8e553c82 08b121bc0749 08fa6f19a4b4 090bc7bcedf6 0a29efb3b1f4 0a748ace387b 0bd9f297bd2d
  0c1c98532322 0c417ceed976 0ce9d9695fe7 0d75dcc29df3 0da880f64dbc 0e48f0da953b 0ed24aecbd33 0fceb9d5e330 0ff5f27c6c88
  106006c7dd40 10ca2acd929e 1154d471530a 12f51873fa85 13565cedcaa9 13fdd3a02593 1669a3658529 17e4b0038fa2 18f6473d61c3
  18f9120a4b87 193ff026b6b9 1a007ae9bda2 1ade6c8ea47e 1b2b88753df7 1c04b4aa1a33 1c80cae9b51d 1d5ffaef16dc 1dee052f2248
  1ef835f97b8c 1fb0741d8874 20aa5c78950a 23f7e222d70b 26a40f65ed75 2753f7905385 28a2f083c04d 29987daaf224 29e6d467ef54
  2a90b5221dd0 2ac7a978f7ad 2b20fe9f0575 2b83c236fb13 2c4b9da327ab 2c7dd320ffd8 2cb847cfa90b 2d000858c5b6 2d8cc1320a91
  2e19ca0b6816 2edb87984558 2f4b52d7bd2f 2f56d2183aa0 30bbd918b9dc 30bd6021e277 3210ffc8422b 3295bd02f217 32c18d29ce78
  333148cf3e34 374e64a9eac8 3806c9c6a96e 39d81dba6d5a 3af3f374c407 3b517fca8d1c 3b55ec4ea364 3caa22c35359 3f4d0cf99f17
  426b93d1912e 4367a3d42916 44a153ee99d6 44b9ab63c76e 4550b257abc0 4593c4a8b755 45ac39667c7c 46893bb5850a 4709fe629637
  479e6e5405b9 4a2e145c3bd6 4ad01c14741e 4c8ccdea8b8a 4d94962ea995 4ef6cd5d2f68 4f18eb4e4339 503aa39c3759 516a24688c57
  51fba85fc541 5254674a39a2 5254f78b2f37 530a40cb9887 543b4e56b78e 54d9104e2059 56009929bcb1 574327a81b5e 58c4c6c79ec3
  58e6195e5f7a 59339df1aa2a 5a51a1dd2fb5 5c21d6f68f32 5d55b078a71e 5da92817c115 5e1d3b1c86e8 5e3ad9b7bee7 5e3dfc1d23d2
  5e56dd6915b6 5e7dd2017159 5e9dae91a42f 5ed60cfa3acf 5f1d532bde4f 5f4f80cb4247 603af7f0c4ed 60974fa96f28 61e74b014684
  620750671695 64e5f68359db 665c2518a0c0 675e0d82c3ae 679cd02ed2aa 6853a82fa943 6864fabc74b6 68d9ecbbfe11 691fb261c438
  6a7bb5e8cf37 6b0de90a37c4 6b41cb76f4e7 6b586df98e95 6c6dbde4069b 6e6ae674a4b7 6fd6b23c89ce 71e994971efc 72c6d735d569
  734f1823c37d 73acd5aee7e1 74f887bb9f48 7675c68c57e1 77176700afff 7838dbdd7427 7bc89226b2a7 7c2ef8d1dd3c 7c8fc3c4d155
  7ced532b8cba 7eefe718c505 7f5fd54b84b7 7f91035bcb82 8071f6fbb174 812b4a23bbb0 812bbd3dfb52 8168e09fa540 82bb1f4ecc13
  82fbed34afa3 8390f1a3b35e 84c7ddbc1463 85f007b6d9ea 880c1071607f 88e55a936714 8a811e313644 8aea5a7459c6 8b8819ffe9a1
  8cdf9b63926d 8ce8fa6aa9df 8d34f638853e 8e13de38dcea 8e37abf51198 8e93710020fe 8f30f26aafb6 8ffad482b760 91177ab3ed29
  91bbbf9f23b9 92a9a7f8e272 92ca644ebfeb 958db4cd00c9 963d72af8a82 98197fe2d571 981dab076dae 993bcf9b1927 9a413f327717
  9a4c6f3fbb36 9ab92249c4c8 9bbaea80cd5b 9d18906ee5fe 9d27c9605e2b 9e082b89d218 9e86516be67d 9fbb67cf3ea8 a282bd401ea7
  a2c6a3cce33b a302676c888a a3a8d61cd194 a44fbc2d7906 a457e6e27cab a5a1aa70316a a61eda83949e a62684029fb5 a644db6d60d2
  a6774626ef36 a6999a12d40f a6b8485e5ee7 a87be3d0ac4b a8907f77dc13 a90c4f0b9e19 a93c67da2a78 a9d3d172a23e a9eb0de3a289
  aa4215d635c4 aa4e5ddfc3cc aac2e42a181e ac5affae7bb6 acf00a684ed9 af3be8112aa6 af56df009b1b afbe006d90f0 affa5bb9c805
  b0bf52a153cb b13e0518f2cf b2a071aa35bf b3eaca8c4ce8 b4c24272cbdf b73535553c49 b790160ed9ab b7a0841a6643 b7f185652a49
  b983c862ba14 bacc5c5b4f4f bc8f299a2336 be5e5620150c be64e4a19976 bf3acc46c065 c00241dcf946 c24872bbe3d2 c2d3d71b4f01
  c2e0cdfff155 c3dcd61c2242 c529a2da2b64 c56ceaa1b43c c96af5902c22 ca39c7258598 cdd5b69ac48b ce03ba95ea14 ce7b73bfc7bf
  ce89a6ab6ff5 cf5b821a0d6a cff68c26d193 d14b6a881ac5 d1862a56f36a d2ef566b17a0 d31ba45dc148 d3af6288df05 d58039179b9b
  d59499bcbe45 d5b0c64a6579 d6b3adeac8a7 d75eacfb10f0 d7c242d7915e d7cb660bc378 d9cc50d773ce dbbf78bd12d8 dc0523cb40c0
  dcd8f433ac17 ddb9f7f29389 dddc53c0ea5a de73470881da de8ecd4ff476 deaddcd7ca3b df558c5df7bc df790ee22338 e0a3491e778d
  e1c1f92da8e0 e38f272f4317 e461f757005f e46990fc1913 e5f29e40e8ed e6db917beac3 e7f8c019b57f e8469ca2008d e96fd5969d93
  e9747d29c3bd e9d360eb83dd ea0178426fae ea940bbbb85f ec3eb3f2e41c ee62e9e2c8aa ef94fbb51f2c f014b86846df f0f70dc94418
  f114f9e88ade f2a65717bd07 f3028758f343 f3f5cc47ec41 f5da2989f5d4 f726a9d57dbc f7ddaf16351d fba8b55aa788 fc0a659aa829
  fc35773af197 fe92c618f634 fede8bed9a22 ffb172e4c694
`;
const PLAN_KENNUNGEN: ReadonlySet<string> = new Set(PLAN_KENNUNGEN_LISTE.trim().split(/\s+/));

const PRUEFSUMMEN = new Map<string, string>();
function pruefsumme(wort: string): string {
  let p = PRUEFSUMMEN.get(wort);
  if (p === undefined) {
    p = createHash("sha256").update(wort).digest("hex").slice(0, 12);
    PRUEFSUMMEN.set(wort, p);
  }
  return p;
}

/** Woerter, die eine Kennung sein koennen: mit Bindestrich oder in Backticks. */
function kennungsWoerter(zeile: string): Set<string> {
  const woerter = new Set<string>();
  for (const teil of zeile.split(/[^A-Za-z0-9-]+/)) {
    const wort = teil.replace(/^-+|-+$/g, "");
    if (wort.includes("-")) woerter.add(wort);
  }
  for (const m of zeile.matchAll(/`([a-z0-9]+)`/g)) woerter.add(m[1]);
  return woerter;
}

/**
 * Angewendete Migrationen bleiben bytegleich: Prisma speichert je
 * Migration eine Pruefsumme, und schon eine geaenderte Kommentarzeile
 * laesst "prisma migrate dev" jede bestehende Entwicklungsdatenbank
 * zuruecksetzen; ein umbenanntes Verzeichnis liefe auf jeder Installation
 * als neue Migration. Nur diese, namentlich; jede neue Migration wird
 * geprueft.
 */
const MIGRATIONEN_VOR_DER_REGEL = [
  "20260519132107_init",
  "20260519135251_space_invitations",
  "20260519140000_page_fulltext_index",
  "20260519142800_admin_and_soft_delete",
  "20260519160604_sessions_account_reset",
  "20260717125329_links_comments_notifications_chunks",
  "20260902200403_stage1_foundation",
  "20260909070000_gruppen_zwei_faktor_sso",
  "20260917120000_pagechunk_fulltext_index",
  "20260922090000_recovery_code_pending",
  "20260925100000_ai_index",
  "20260925110000_search_german_trgm",
  "20260925120000_page_updated_notification",
  "20260925130000_restore_epoch",
  "20260925150000_aufbewahrung",
];

function ausgenommen(datei: string): boolean {
  return (
    MIGRATIONEN_VOR_DER_REGEL.some((m) => datei.startsWith(`packages/db/prisma/migrations/${m}/`)) ||
    // Fremde Paketnamen und Pruefsummen
    datei === "pnpm-lock.yaml" ||
    // Diese Datei nennt die Muster und alte Titel als Beispiele
    datei === "apps/web/src/konventionen.test.ts"
  );
}

/** Alle Planbezuege eines Textes; ueber einen Zeilenumbruch nur, wenn er ihn trennt. */
function planbezuege(datei: string, text: string, kennungen = PLAN_KENNUNGEN): string[] {
  const funde: string[] = [];
  const regeln = PLANBEZUEGE.filter((r) => !r.nur || r.nur.test(datei));
  const melde = (wo: string, art: string, treffer: string) =>
    funde.push(`${wo}: ${art} "${treffer}": name it after what it does (CONTRIBUTING.md)`);
  const kennung = (wo: string, zeile: string) => {
    for (const wort of kennungsWoerter(zeile)) {
      if (kennungen.has(pruefsumme(wort))) melde(wo, "plan id", wort);
    }
  };
  for (const r of regeln) {
    const m = r.muster.exec(datei);
    if (m) melde(datei, r.art, m[0]);
  }
  kennung(datei, datei);
  const zeilen = text.split("\n");
  zeilen.forEach((zeile, i) => {
    kennung(`${datei}:${i + 1}`, zeile);
    for (const r of regeln) {
      const m = r.muster.exec(zeile);
      if (m) melde(`${datei}:${i + 1}`, r.art, m[0]);
      // Umbrochen wie "(Commit 84a44cc, Punkte" / "# 1 bis 6)": die
      // naechste Zeile ohne Einrueckung und Kommentarzeichen anhaengen
      const naechste = zeilen[i + 1];
      if (naechste === undefined) continue;
      const links = zeile.trimEnd();
      const paar = `${links} ${naechste.replace(/^\s*(?:#|\/\/|\*|--)?\s*/, "")}`;
      for (const p of paar.matchAll(new RegExp(r.muster.source, `${r.muster.flags}g`))) {
        const ende = (p.index ?? 0) + p[0].length;
        if ((p.index ?? 0) < links.length && ende > links.length + 1) {
          melde(`${datei}:${i + 1}-${i + 2}`, r.art, p[0]);
        }
      }
    }
  });
  return funde;
}

/** Startet das Skript wie der Workflow: nur mit PATH, Titel und Autor. */
function aufruf(titel: string, autor = "jemand") {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", PR_TITLE: titel, PR_AUTHOR: autor };
  const r = spawnSync(process.execPath, [SKRIPT], { env: env as NodeJS.ProcessEnv, encoding: "utf8" });
  return { code: r.status, zeilen: r.stdout.split("\n").filter((z) => z !== "") };
}

describe("Konventionen", () => {
  it.each([
    "fix(collab): keep edits when Redis restarts",
    "feat!: require Node 26",
    "feat(api)!: drop v0 tokens",
    "ci: add CodeQL code scanning",
    "chore(deps-dev): bump the eslint group across 1 directory with 2 updates",
    "fix(deps): bump the other group across 1 directory with 12 updates",
    // Dependabot schreibt "bump" je nach Historie gross; die Beschreibung
    // darf mit einem Grossbuchstaben beginnen
    "fix(deps): Bump next from 16.3.6 to 16.3.7",
    "chore(deps-dev): [security] bump vite from 8.0.1 to 8.0.2",
    "revert: fix(web): show the SSO button again",
    "docs(contributing): describe branch names",
    "fix: " + "a".repeat(95),
  ])("PR-Titel: gueltig %s", (titel) => {
    expect(pruefeTitel(titel)).toEqual([]);
  });

  it.each([
    // Betreffe aus der Historie dieses Repositorys
    ["Folgepunkte: Suchparameter ohne Serverfehler", 'Unknown type "Folgepunkte"'],
    ["Punkt 4: Nacharbeit nach Pruefung", "must look like"],
    // Dependabot ohne commit-message in dependabot.yml
    ["Bump mermaid from 11.16.1 to 12.0.0", "must look like"],
    [
      "Chore(deps-dev): Bump @types/node from 26.6.2 to 26.6.3 in the uebrige group across 1 directory",
      'Unknown type "Chore"',
    ],
    ["Fix(collab): keep edits", 'Unknown type "Fix"'],
    ["feature: add x", 'Unknown type "feature"'],
    ["fix(Collab): keep edits", "The scope"],
    ["fix(): x", "The scope"],
    ["fix(web collab): x", "The scope"],
    ["fix(collab) keep edits", "must look like"],
    ["fix:keep edits", "must look like"],
    ["fix: ", "is missing"],
    ["fix:  keep edits", "start or end with a space"],
    ["fix: keep edits ", "start or end with a space"],
    ["fix: ends with period.", "full stop"],
    // Vorschlag des Revert-Knopfs von GitHub
    ['Revert "fix(web): show the SSO button again"', "revert: <title"],
  ])("PR-Titel: ungueltig %s", (titel, teil) => {
    const fehler = pruefeTitel(titel);
    expect(fehler.join("\n")).toContain(teil);
  });

  it("PR-Titel: hoechstens 100 Codepoints, ausser bei Dependabot", () => {
    expect(MAX_LAENGE).toBe(100);
    expect(pruefeTitel("fix: " + "a".repeat(96))).toEqual([
      "The title has 101 characters; keep it at 100 or fewer.",
    ]);
    // 100 Codepoints, aber 195 UTF-16-Einheiten
    expect(pruefeTitel("fix: " + "😀".repeat(95))).toEqual([]);
    // Dependabot kuerzt seine Titel nicht (eine Gruppe mit einem Update
    // kommt auf 106 Zeichen, mit [security] auf 110); fuer ihn entfaellt
    // nur die Laenge, nicht die Form.
    const lang =
      "chore(deps-dev): [security] bump eslint-plugin-react-hooks from 7.1.1 to 7.2.0 in the eslint group across 1 directory";
    expect([...lang].length).toBeGreaterThan(100);
    expect(pruefeTitel(lang).join("\n")).toContain("keep it at 100 or fewer");
    expect(pruefeTitel(lang, { autor: DEPENDABOT })).toEqual([]);
    expect(pruefeTitel("Bump x from 1.0.0 to 1.0.1", { autor: DEPENDABOT }).join("\n")).toContain(
      "must look like",
    );
  });

  it("PR-Titel-Workflow: Skript vom Zielbranch, alle Ereignisse, nur Leserecht, Titel nur ueber env", () => {
    const wf = parse(lesen(".github/workflows/pr-title.yml")) as Workflow;
    // pull_request_target: Workflow und Skript kommen vom Zielbranch. Mit
    // pull_request liefe das Skript aus dem Pull-Request, der es aendern
    // und so seine eigene Pruefung bestehen koennte.
    expect(Object.keys(wf.on)).toEqual(["pull_request_target"]);
    expect(wf.on.pull_request_target?.types).toEqual(
      expect.arrayContaining(["opened", "edited", "reopened", "synchronize"]),
    );
    expect(wf.permissions).toEqual({ contents: "read" });
    const schritte = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
    for (const s of schritte) {
      // Kein Ausdruck in run: ein Titel wie 'fix: $(curl …)' liefe sonst
      // als Befehl
      expect(s.run ?? "", s.name).not.toContain("${{");
      if (s.uses !== undefined) {
        // Im Kontext von pull_request_target nur der Checkout, und der nie
        // mit einem ref: aus dem Pull-Request
        expect(s.uses, s.name).toMatch(/^actions\/checkout@/);
        expect(s.with?.ref, s.uses).toBeUndefined();
        expect(s.with?.["persist-credentials"], s.uses).toBe(false);
      }
    }
    const pruefung = schritte.filter((s) => (s.run ?? "").includes(".github/scripts/pr-title.mjs"));
    expect(pruefung).toHaveLength(1);
    expect(pruefung[0].run?.trim()).toBe("node .github/scripts/pr-title.mjs");
    expect(pruefung[0].env).toEqual({
      PR_TITLE: "${{ github.event.pull_request.title }}",
      PR_AUTHOR: "${{ github.event.pull_request.user.login }}",
    });
  });

  it("PR-Titel-Skript: Aufruf wie im Workflow, Meldungen als maskierte Workflow-Befehle", () => {
    const gut = aufruf("ci: check pull request titles against Conventional Commits");
    expect(gut.code).toBe(0);
    expect(gut.zeilen).toEqual(["The pull request title follows Conventional Commits."]);

    const schlecht = aufruf("Bump x");
    expect(schlecht.code).toBe(1);
    expect(schlecht.zeilen[0]).toMatch(/^::error title=Pull request title::The title must look like/);
    expect(schlecht.zeilen.at(-1)).toContain("CONTRIBUTING.md");
    // Der Titel selbst erscheint nie in der Ausgabe
    expect(schlecht.zeilen.join("\n")).not.toContain("Bump x");

    // % im geprueften Teil wird maskiert: der Runner dekodiert %25 zurueck
    // zu %, aus "%0A" wird also kein Zeilenumbruch
    const typ = aufruf("fe%0Aat: add x");
    expect(typ.code).toBe(1);
    expect(typ.zeilen[0]).toBe(
      `::error title=Pull request title::Unknown type "fe%250Aat". Use one of: ${TYPEN.join(", ")}.`,
    );

    const lang = `fix(deps): bump ${"a".repeat(100)} from 1.0.0 to 1.0.1`;
    expect(aufruf(lang, DEPENDABOT).code).toBe(0);
    expect(aufruf(lang).code).toBe(1);
  });

  it("Dependabot: jeder Vorschlag besteht die Titelpruefung", () => {
    type Update = {
      "package-ecosystem": string;
      "commit-message"?: { prefix?: string; "prefix-development"?: string; include?: string };
      groups?: Record<string, { patterns?: string[] }>;
    };
    const updates = (parse(lesen(".github/dependabot.yml")) as { updates: Update[] }).updates;

    // Alle Pakete des Workspaces, fuer den laengsten realistischen Titel je
    // Gruppe
    const pakete = new Set<string>();
    const manifeste = [
      "package.json",
      ...["apps", "packages"].flatMap((d) =>
        readdirSync(join(ROOT, d)).map((p) => `${d}/${p}/package.json`),
      ),
    ];
    for (const m of manifeste) {
      let json: Record<string, Record<string, string> | undefined>;
      try {
        json = JSON.parse(lesen(m));
      } catch {
        continue;
      }
      for (const feld of ["dependencies", "devDependencies"]) {
        for (const name of Object.keys(json[feld] ?? {})) pakete.add(name);
      }
    }
    expect(pakete.size).toBeGreaterThan(10);
    const passt = (muster: string, name: string) =>
      new RegExp(`^${muster.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(name);

    for (const u of updates) {
      const oeko = u["package-ecosystem"];
      const cm = u["commit-message"];
      expect(cm?.include, oeko).toBe("scope");
      expect(cm?.prefix, oeko).toBeTruthy();
      const praefixe: [string, string][] = [[cm?.prefix ?? "", "deps"]];
      if (oeko === "npm") {
        expect(cm?.["prefix-development"], oeko).toBeTruthy();
        praefixe.push([cm?.["prefix-development"] ?? "", "deps-dev"]);
      }
      const titel: string[] = [];
      for (const [p, scope] of praefixe) {
        titel.push(`${p}(${scope}): bump example from 1.0.0 to 1.1.0`);
        titel.push(`${p}(${scope}): [security] bump example from 1.0.0 to 1.1.0`);
        for (const [gruppe, g] of Object.entries(u.groups ?? {})) {
          const namen = [...pakete].filter((n) => (g.patterns ?? []).some((m) => passt(m, n)));
          const laengster = namen.sort((a, b) => b.length - a.length)[0] ?? "example";
          titel.push(`${p}(${scope}): bump the ${gruppe} group across 1 directory with 12 updates`);
          titel.push(
            `${p}(${scope}): [security] bump ${laengster} from 10.100.1000 to 10.100.1001 in the ${gruppe} group across 1 directory`,
          );
        }
      }
      for (const t of titel) {
        expect(pruefeTitel(t, { autor: DEPENDABOT }), t).toEqual([]);
      }
    }
  });

  it("Keine internen Planbezuege in versionierten Dateien und Pfaden", () => {
    const r = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, "git ls-files braucht ein Git-Checkout").toBe(0);
    const dateien = r.stdout.split("\0").filter((d) => d !== "");
    expect(dateien.length).toBeGreaterThan(100);
    const funde: string[] = [];
    for (const datei of dateien) {
      if (ausgenommen(datei)) continue;
      const pfad = join(ROOT, datei);
      // Geloescht, aber noch nicht aus dem Index: nur der Pfad zaehlt
      const inhalt = existsSync(pfad) ? readFileSync(pfad) : Buffer.alloc(0);
      // Binaerdateien (NUL-Byte wie bei git) nur mit ihrem Pfad
      const text = inhalt.subarray(0, 8000).includes(0) ? "" : inhalt.toString("utf8");
      funde.push(...planbezuege(datei, text));
    }
    expect(funde).toEqual([]);
  });

  it("Planbezuege: Muster und Ausnahmen", () => {
    expect(planbezuege("a.ts", "// wie vor Punkt 10")).toHaveLength(1);
    expect(planbezuege("a.ts", "// Folgepunkte A")).toHaveLength(1);
    expect(planbezuege("a.ts", "// der Befund B148")).toHaveLength(1);
    expect(planbezuege("a.ts", "// (Kritik 12/K11)")).toHaveLength(1);
    expect(planbezuege("a.ts", "// siehe K7")).toHaveLength(1);
    expect(planbezuege("e2e/stage3-size-lock.spec.ts", "")).toHaveLength(1);
    expect(planbezuege("x/20260902200403_stage1_foundation/m.sql", "")).toHaveLength(1);
    expect(planbezuege("a.ts", "// E2E fuer Navigation (Stufe 1)")).toHaveLength(1);
    expect(planbezuege("CHANGELOG.md", "- Added in E1.")).toHaveLength(1);
    expect(planbezuege("a.yml", "  # (Commit 84a44cc, Punkte\n  # 1 bis 6)")).toEqual([
      'a.yml:1-2: plan item "Punkte 1": name it after what it does (CONTRIBUTING.md)',
    ]);
    // Kennungen von Luecken und Entscheidungen, wie man sie zitiert
    // (ausgedachte, im Format der echten)
    expect(planbezuege("CONTRIBUTING.md", "See `qa-muster-luecke`.")).toHaveLength(1);
    expect(planbezuege("a.ts", "// siehe `editor-muster-kennung-zwei`")).toHaveLength(1);
    expect(planbezuege("a.mjs", "// Meldungen englisch (D42)")).toHaveLength(1);
    expect(planbezuege("a.md", "as agreed in decision D17b")).toHaveLength(1);
    // Jede Kennung einer Luecke ueber ihre Pruefsumme, auch ohne Backticks
    // und ohne gemeinsames Praefix (ausgedachte Kennungen, deren
    // Pruefsummen nur dieser Test in die Liste aufnimmt)
    const probe = new Set([...PLAN_KENNUNGEN, pruefsumme("muster-kennung-probe"), pruefsumme("musterwort")]);
    expect(planbezuege("a.md", "See muster-kennung-probe for details.", probe)).toEqual([
      'a.md:1: plan id "muster-kennung-probe": name it after what it does (CONTRIBUTING.md)',
    ]);
    expect(planbezuege("a.ts", "// wie gefordert (muster-kennung-probe)", probe)).toHaveLength(1);
    expect(planbezuege("e2e/muster-kennung-probe.spec.ts", "", probe)).toHaveLength(1);
    expect(planbezuege("a.md", "See `musterwort`.", probe)).toHaveLength(1);
    // Nur ganze Woerter wie im Plan geschrieben; ein Wort ohne Bindestrich
    // nur in Backticks, sonst waere es gewoehnlicher Text
    for (const text of ["muster-kennung-probe-zwei", "Muster-Kennung-Probe", "musterwort"]) {
      expect(planbezuege("a.md", text, probe), text).toEqual([]);
    }
    // Ohne ihre Pruefsumme schlaegt die Kennung nicht an
    expect(planbezuege("a.md", "See muster-kennung-probe for details.")).toEqual([]);
    // Keine Fehltreffer
    for (const [datei, text] of [
      ["a.ts", "let E1: string; // E2E ohne Punkt, Punkt eins"],
      ["a.ts", "// W3C, B2B, K8s, E2E-Datei, stages, backstage 2"],
      ["a.md", "E2E tests"],
      ["a.ts", "// JPEG beginnt mit FF D8 FF; =SUMME(D1:D5)"],
      ["a.md", "`editor-content`, `api-key`, `ui-state`, `deps-dev`, `no-new-privileges`"],
    ]) {
      expect(planbezuege(datei, text), text).toEqual([]);
    }
    expect(ausgenommen("packages/db/prisma/migrations/20260925150000_aufbewahrung/migration.sql")).toBe(true);
    expect(ausgenommen("packages/db/prisma/migrations/20261001000000_neu/migration.sql")).toBe(false);
  });

  it("Planbezuege: Pruefsummen aller Kennungen von Luecken", () => {
    const liste = PLAN_KENNUNGEN_LISTE.trim().split(/\s+/);
    expect(liste).toHaveLength(310);
    expect(new Set(liste).size).toBe(liste.length);
    for (const p of liste) expect(p).toMatch(/^[0-9a-f]{12}$/);
  });

  it("CONTRIBUTING: dieselben Typen und dieselbe Laenge wie die Pruefung", () => {
    const text = lesen("CONTRIBUTING.md");
    const typen = [...text.matchAll(/^\| `([a-z]+)` \|/gm)].map((m) => m[1]);
    expect([...typen].sort()).toEqual([...TYPEN].sort());
    expect(text).toContain(`at most ${MAX_LAENGE} characters`);
    // Die Regel fuer parallele Zweige steht dort, wo Beitragende sie lesen
    expect(text).toContain("merge=union");
    expect(lesen(".gitattributes")).toMatch(/^CHANGELOG\.md merge=union$/m);
  });

  it("CONTRIBUTING: der PR-Titel wird Betreff auf main und Grundlage der Changelog-Zeile", () => {
    // Der gepruefte Titel ist das, woraus Werkzeuge fuer Conventional
    // Commits den Changelog bauen. Solange keins eingerichtet ist,
    // schreibt der Pull-Request seinen Eintrag von Hand; beides steht bei
    // den Pull-Requests, wo Beitragende den Titel waehlen.
    const text = lesen("CONTRIBUTING.md");
    const prs = /^## Pull requests\n([\s\S]*?)^## /m.exec(text)?.[1] ?? "";
    expect(prs).toContain("becomes the subject of the commit on `main`");
    expect(prs).toMatch(/changelog[^\n]*from these subjects/i);
    expect(prs).toContain("to `CHANGELOG.md` by hand");
  });
});
