import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Lieferkette: Update-Weg, CI-Gates, Dependabot und Ausnahmen.
 *
 * Geprueft wird nur, was Dateien gegeneinander haelt oder eine Regel
 * festschreibt, die sonst niemand prueft: der Update-Befehl im README
 * gegen den CI-Schritt, der ihn ausfuehrt; exakt gepinnte Overrides
 * gegen die Ausnahmen von Dependabot; die pnpm-Version an jeder Stelle;
 * die Ausnahmen fuer pnpm audit und Trivy (eng und befristet); die
 * Zeitgrenzen und die concurrency-Gruppen aller Workflows; die
 * Service-Images des e2e-Jobs gegen docker-compose.yml. Das Geruest des Workflows steht in einem Test. Ob
 * die Befehle wirklich laufen, prueft der CI-Job docker, ob die Gates
 * greifen, die Jobs audit und docker.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function lesen(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

type Obj = Record<string, unknown>;

type Schritt = {
  name?: string;
  uses?: string;
  run?: string;
  if?: unknown;
  "continue-on-error"?: unknown;
  "timeout-minutes"?: number;
  with?: Obj;
};

type Job = {
  if?: unknown;
  "continue-on-error"?: unknown;
  "timeout-minutes"?: number;
  permissions?: unknown;
  services?: Record<string, { image?: string }>;
  steps?: Schritt[];
};

type Workflow = {
  on: Obj;
  permissions?: unknown;
  concurrency?: { group?: string; "cancel-in-progress"?: unknown };
  jobs: Record<string, Job>;
};

const ci = (): Workflow => parse(lesen(".github/workflows/ci.yml"));

/** Alle Workflows mit Dateinamen, auch kuenftige. */
function workflows(): [string, Workflow][] {
  return readdirSync(join(ROOT, ".github/workflows"))
    .filter((d) => /\.ya?ml$/.test(d))
    .sort()
    .map((d) => [d, parse(lesen(`.github/workflows/${d}`)) as Workflow]);
}

/** Ausloeser eines Workflows; `on` darf Text, Liste oder Objekt sein. */
function ereignisse(wf: Workflow): string[] {
  const on = wf.on as unknown;
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  return Object.keys(on as Obj);
}

/**
 * concurrency-Gruppe: bei einem Pull-Request dessen Ref
 * (refs/pull/N/merge), sonst die run_id des Laufs. Ein neuer Push auf
 * einen Pull-Request bricht so dessen laufenden Lauf ab; jeder andere
 * Lauf (Push auf main oder einen Branch, Montagslauf, Handstart) hat eine
 * eigene Gruppe und laeuft zu Ende. Mit der Gruppe github.ref allein
 * teilten sich alle Pushes auf main eine Gruppe, und ein dritter Push
 * braeche den Lauf des zweiten ab. Fester Text statt eines Auswerters der
 * Ausdruckssprache: der Ausdruck ist kurz genug, um ihn zu lesen.
 */
const GRUPPE_JE_PR =
  "${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}";
/** Fuer Workflows, die nur auf Pull-Requests laufen (auch pull_request_target). */
const GRUPPE_PR_NUMMER =
  "${{ github.workflow }}-${{ github.event.pull_request.number }}";
const dependabot = (): {
  version: number;
  updates: {
    "package-ecosystem": string;
    directory: string;
    schedule?: { interval?: string };
    cooldown?: { "default-days"?: number };
    ignore?: { "dependency-name": string; "update-types"?: string[] }[];
  }[];
} => parse(lesen(".github/dependabot.yml"));
const workspace = (): {
  minimumReleaseAge: number;
  overrides: Record<string, string>;
  auditConfig?: { ignoreGhsas?: string[] };
} => parse(lesen("pnpm-workspace.yaml"));
const trivyIgnore = (): { vulnerabilities: Obj[] } =>
  parse(lesen(".trivyignore.yaml"));
const compose = (): { services: Record<string, { image?: string }> } =>
  parse(lesen("docker-compose.yml"));

/** Der ganze Update-Befehl, wie ihn das README als letzte Zeile nennt. */
const KETTE =
  "git pull && docker compose pull --ignore-buildable && docker compose build --pull && docker compose up -d --wait";

/**
 * Die Befehle des ersten eingerueckten Codeblocks unter
 * "### Update und Rückweg": Zeilen mit `\` am Ende zusammengefuegt,
 * Kommentare entfernt, Leerraum vereinheitlicht.
 */
function updateKette(): string[] {
  const zeilen = lesen("README.md").split("\n");
  const kopf = zeilen.indexOf("### Update und Rückweg");
  expect(kopf, "Abschnitt fehlt im README").toBeGreaterThanOrEqual(0);
  let i = kopf + 1;
  while (i < zeilen.length && !/^ {4}\S/.test(zeilen[i])) {
    // Nicht in den naechsten Abschnitt laufen
    expect(zeilen[i].startsWith("#"), "kein Codeblock im Abschnitt").toBe(
      false,
    );
    i++;
  }
  const block: string[] = [];
  for (; i < zeilen.length && /^ {4}/.test(zeilen[i]); i++) {
    block.push(zeilen[i].slice(4));
  }
  const befehle: string[] = [];
  let offen = "";
  for (const zeile of block) {
    const ohneKommentar = zeile.replace(/\s+#.*$/, "");
    if (/\\\s*$/.test(ohneKommentar)) {
      offen += ohneKommentar.replace(/\\\s*$/, " ");
      continue;
    }
    befehle.push((offen + ohneKommentar).replace(/\s+/g, " ").trim());
    offen = "";
  }
  if (offen) befehle.push(offen.replace(/\s+/g, " ").trim());
  return befehle.filter((b) => b !== "");
}

function schritte(wf: Workflow): Schritt[] {
  return Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
}

function runZeilen(schritt: Schritt | undefined): string[] {
  return (schritt?.run ?? "")
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z !== "");
}

describe("Lieferkette", () => {
  it("README: Update-Befehl holt Images und baut mit --pull, verkettet", () => {
    const befehle = updateKette();
    expect(befehle.at(-1)).toBe(KETTE);
    // up --build baute die App aus dem Zwischenspeicher und holte weder
    // das Basis-Image noch die Images der Dienste neu.
    for (const befehl of befehle) {
      for (const teil of befehl.split("&&")) {
        const w = teil.trim().split(/\s+/);
        expect(w.includes("up") && w.includes("--build"), befehl).toBe(false);
      }
    }
  });

  it("CI: der Docker-Job fuehrt genau den Update-Befehl aus dem README aus", () => {
    const schritt = ci().jobs.docker?.steps?.find(
      (s) => s.name === "Update-Weg aus dem README",
    );
    expect(schritt, "Schritt fehlt").toBeDefined();
    const zeilen = runZeilen(schritt);
    const ohneGitPull = KETTE.replace(/^git pull && /, "");
    expect(ohneGitPull).not.toBe(KETTE);
    // set -e bricht in einer &&-Liste nur ab, wenn das letzte Glied
    // scheitert. Ohne "|| exit 1" liefe der Schritt nach einem
    // gescheiterten pull oder build --pull weiter und faende den alten
    // Stack gesund.
    expect(zeilen).toContain(`${ohneGitPull} || exit 1`);
    // Mit einer override-Datei, die der App ein image: gibt, scheitert
    // pull ohne --ignore-buildable ("pull access denied").
    expect(
      zeilen.some((z) =>
        /^docker compose( -f \S+){2,} pull --ignore-buildable$/.test(z),
      ),
      zeilen.join("\n"),
    ).toBe(true);
  });

  it("CI: Leserechte, Montagslauf, pnpm audit und Trivy als Gate", () => {
    const wf = ci();
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const [name, job] of Object.entries(wf.jobs)) {
      expect(JSON.stringify(job.permissions ?? {}), name).not.toMatch(/write/);
    }

    const schedule = wf.on.schedule as { cron: string }[];
    expect(schedule?.length).toBeGreaterThanOrEqual(1);
    for (const s of schedule) {
      expect(s.cron.trim().split(/\s+/)).toHaveLength(5);
    }
    expect("pull_request" in wf.on).toBe(true);
    expect(
      (wf.on.push as Obj | undefined)?.["branches-ignore"] as string[],
    ).toContain("dependabot/**");

    // Das Gate darf nicht still uebersprungen oder gruen gemacht werden.
    const auditJobs = Object.entries(wf.jobs).filter(([, job]) =>
      (job.steps ?? []).some((s) =>
        runZeilen(s).includes("pnpm audit --prod --audit-level high"),
      ),
    );
    expect(auditJobs.length).toBeGreaterThanOrEqual(1);
    for (const [name, job] of auditJobs) {
      expect(job.if, name).toBeUndefined();
      expect(job["continue-on-error"], name).toBeUndefined();
      const s = (job.steps ?? []).find((s) =>
        runZeilen(s).includes("pnpm audit --prod --audit-level high"),
      );
      expect(s?.if, name).toBeUndefined();
      expect(s?.["continue-on-error"], name).toBeUndefined();
    }

    const trivy = schritte(wf).filter((s) =>
      s.uses?.startsWith("aquasecurity/trivy-action@"),
    );
    expect(trivy.length).toBeGreaterThanOrEqual(2);
    for (const s of trivy) {
      const w = s.with ?? {};
      expect(s.uses, s.name).toMatch(/^aquasecurity\/trivy-action@[0-9a-f]{40}$/);
      expect(w.version, s.name).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(w.severity, s.name).toBe("HIGH,CRITICAL");
      expect(w["exit-code"], s.name).toBe("1");
      expect(w["ignore-unfixed"], s.name).toBe(true);
      expect(w.trivyignores, s.name).toBe(".trivyignore.yaml");
      expect(s["continue-on-error"], s.name).toBeUndefined();
      // Auch nach einem roten Schritt davor (pnpm audit, Rundlauf) zeigt
      // Trivy sein Ergebnis, sonst bleibt ein zweiter Befund verdeckt.
      expect(String(s.if ?? ""), s.name).toMatch(/!cancelled\(\)/);
    }
    expect(existsSync(join(ROOT, ".trivyignore.yaml"))).toBe(true);
    // Lockfile (auch Pakete, die nicht im Image landen) und Image der App
    expect(
      trivy.some(
        (s) =>
          s.with?.["scan-type"] === "fs" &&
          s.with?.["scan-ref"] === "pnpm-lock.yaml",
      ),
    ).toBe(true);
    expect(trivy.some((s) => typeof s.with?.["image-ref"] === "string")).toBe(
      true,
    );
  });

  it("Alle Workflows: jeder Job hat eine Zeitgrenze, Playwright ein Budget darunter", () => {
    // Ohne timeout-minutes laeuft ein Haenger bis zur Grenze von GitHub
    // (360 min), wie der e2e-Job von PR #12. Das gilt fuer jeden Workflow,
    // auch einen kuenftigen.
    for (const [datei, wf] of workflows()) {
      for (const [name, job] of Object.entries(wf.jobs)) {
        const wo = `${datei}:${name}`;
        const grenze = job["timeout-minutes"] ?? 0;
        expect(Number.isInteger(job["timeout-minutes"]), `${wo} ohne Zeitgrenze`).toBe(true);
        expect(grenze, wo).toBeGreaterThan(0);
        expect(grenze, wo).toBeLessThan(360);
        // Laeuft die Grenze eines Schritts ab, gilt er als gescheitert, und
        // Schritte mit failure() laufen noch; laeuft die des Jobs ab,
        // bricht GitHub ihn ab (cancelled), und sie entfallen. Die
        // Jobgrenze liegt deshalb mindestens 10 min ueber der Summe der
        // begrenzten Schritte: fuer die unbegrenzten davor (Checkout,
        // Install, Build) und die danach (Upload).
        const begrenzt = (job.steps ?? []).flatMap((s) =>
          s["timeout-minutes"] === undefined ? [] : [s["timeout-minutes"]],
        );
        for (const g of begrenzt) {
          expect(Number.isInteger(g) && g > 0, `${wo}: Schrittgrenze ${g}`).toBe(true);
        }
        if (begrenzt.length > 0) {
          const summe = begrenzt.reduce((a, b) => a + b, 0);
          expect(grenze, `${wo}: ${begrenzt.join(" + ")} + 10`).toBeGreaterThanOrEqual(
            summe + 10,
          );
        }
      }
    }

    // Die Integrationstests laufen im Job e2e vor Playwright. Haengen sie,
    // soll ihr Schritt scheitern und nicht die Grenze des Jobs ablaufen.
    const wf = ci();
    const e2e = wf.jobs.e2e;
    const integration = e2e?.steps?.find((s) =>
      runZeilen(s).includes("pnpm test:integration"),
    );
    expect(integration, "Schritt mit pnpm test:integration fehlt").toBeDefined();
    expect(
      Number.isInteger(integration?.["timeout-minutes"]),
      `${integration?.name} ohne Zeitgrenze`,
    ).toBe(true);

    // Playwright bricht mit seinem Budget (--global-timeout) selbst ab,
    // mit Zusammenfassung und Annotationen, und endet binnen 30 s danach.
    // Die Grenze des Schritts liegt mindestens 3 min darueber und faengt
    // nur Haenger ab; laeuft sie ab, gilt der Schritt als gescheitert, und
    // der Upload mit failure() laeuft noch. Die Grenze des Jobs bricht
    // dagegen ab (cancelled), dann faellt der Upload weg. Deshalb braucht
    // sie Abstand zur Grenze des Schritts: fuer die Schritte davor (bis
    // 6 min Ende September 2026) und den Upload. Nur "Schritt < Job"
    // liesse 29 zu 30 durch.
    const playwright = e2e?.steps?.find((s) =>
      runZeilen(s).some((z) => /^pnpm test:e2e(\s|$)/.test(z)),
    );
    const upload = e2e?.steps?.find((s) =>
      s.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(String(upload?.if ?? "")).toMatch(/failure\(\)/);
    const budget = /--global-timeout[= ](\d+)\b/.exec(
      runZeilen(playwright).join("\n"),
    );
    const budgetMin = Number(budget?.[1]) / 60_000;
    const schritt = playwright?.["timeout-minutes"] ?? 0;
    const job = e2e?.["timeout-minutes"] ?? 0;
    expect(budgetMin).toBeGreaterThan(0);
    expect(Number.isInteger(schritt)).toBe(true);
    expect(schritt - budgetMin).toBeGreaterThanOrEqual(3);
    expect(job - schritt).toBeGreaterThanOrEqual(15);
  });

  it("Alle Workflows: ein neuer Push bricht nur den Lauf desselben Pull-Requests ab", () => {
    const alle = workflows();
    expect(alle.map(([datei]) => datei)).toContain("ci.yml");
    for (const [datei, wf] of alle) {
      const c = wf.concurrency;
      expect(c, `${datei} ohne concurrency`).toBeDefined();
      expect(c?.["cancel-in-progress"], datei).toBe(true);
      // Laeuft ein Workflow auch auf Pushes, nach Zeitplan oder von Hand,
      // behaelt jeder dieser Laeufe seine eigene Gruppe (run_id): jeder
      // Commit auf main bekommt seinen vollstaendigen Lauf.
      const nurPr = ereignisse(wf).every(
        (e) => e === "pull_request" || e === "pull_request_target",
      );
      expect(nurPr ? [GRUPPE_JE_PR, GRUPPE_PR_NUMMER] : [GRUPPE_JE_PR], datei).toContain(
        c?.group,
      );
    }
  });

  it("Dependabot: Oekosysteme, Karenzzeit, exakte Overrides und Hauptversionen", () => {
    const d = dependabot();
    const ws = workspace();
    expect(d.version).toBe(2);
    const je = new Map(d.updates.map((u) => [u["package-ecosystem"], u]));
    for (const oeko of ["npm", "docker", "docker-compose", "github-actions"]) {
      const u = je.get(oeko);
      expect(u, oeko).toBeDefined();
      expect(u?.directory, oeko).toBe("/");
      expect(u?.schedule?.interval, oeko).toBeTruthy();
    }

    // Ein Vorschlag juenger als minimumReleaseAge scheitert an pnpm install.
    const npm = je.get("npm");
    expect(npm?.cooldown?.["default-days"]).toBeGreaterThanOrEqual(
      Math.ceil(ws.minimumReleaseAge / 1440),
    );

    // Ein Override auf genau eine Version haelt das Paket fest; ein PR, der
    // nur die package.json hebt, installierte trotzdem die alte Version.
    const exakt = Object.entries(ws.overrides)
      .filter(([, wert]) => /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(wert))
      .map(([schluessel]) => {
        const letztes = schluessel.split(">").at(-1) ?? schluessel;
        return letztes.replace(/^(@?[^@]+)@.*$/, "$1");
      });
    expect(exakt).toContain("@tiptap/*");
    for (const name of exakt) {
      expect(
        npm?.ignore?.some(
          (e) => e["dependency-name"] === name && !e["update-types"],
        ),
        name,
      ).toBe(true);
    }

    // Datenverzeichnis (Postgres) und AOF (Redis) ohne Rueckweg
    const dc = je.get("docker-compose");
    for (const name of ["postgres", "redis"]) {
      expect(
        dc?.ignore?.some(
          (e) =>
            e["dependency-name"] === name &&
            (e["update-types"] ?? []).includes("version-update:semver-major"),
        ),
        name,
      ).toBe(true);
    }
  });

  it("pnpm-Version: package.json, Dockerfile und CI gleich", () => {
    const pm = JSON.parse(lesen("package.json")).packageManager as string;
    const version = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pm)?.[1];
    expect(version, pm).toBeDefined();
    const muster = /npm install -g pnpm@(\S+)/g;

    const docker = [...lesen("Dockerfile").matchAll(muster)].map((m) => m[1]);
    expect(docker.length).toBeGreaterThanOrEqual(1);
    const inCi = schritte(ci()).flatMap((s) =>
      [...(s.run ?? "").matchAll(muster)].map((m) => m[1]),
    );
    expect(inCi.length).toBeGreaterThanOrEqual(3);
    for (const v of [...docker, ...inCi]) expect(v).toBe(version);
  });

  it("Ausnahmen: eng (Paketversion), befristet und begruendet", () => {
    const eintraege = trivyIgnore().vulnerabilities;
    expect(eintraege.length).toBeGreaterThanOrEqual(1);
    const statements: string[] = [];
    for (const e of eintraege) {
      const id = String(e.id);
      expect(id).toMatch(/^(CVE-\d{4}-\d+|GHSA(-[0-9a-z]{4}){3})$/);
      const purls = e.purls as unknown;
      expect(Array.isArray(purls) && purls.length > 0, id).toBe(true);
      // npm-Pakete oder Debian-Pakete des Basis-Images, immer mit Version
      for (const p of purls as string[]) {
        expect(p, id).toMatch(
          /^pkg:(npm\/(@[^/@]+\/)?[^/@]+@\d[^\s@]*|deb\/debian\/[^/@\s]+@[^\s@]+)$/,
        );
      }
      const ablauf =
        e.expired_at instanceof Date
          ? e.expired_at.toISOString().slice(0, 10)
          : e.expired_at;
      expect(ablauf, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof e.statement === "string" && e.statement.trim(), id).toBeTruthy();
      statements.push(String(e.statement));
    }

    const ghsas = workspace().auditConfig?.ignoreGhsas ?? [];
    const text = lesen("pnpm-workspace.yaml").split("\n");
    for (const ghsa of ghsas) {
      expect(ghsa).toMatch(/^GHSA(-[0-9a-z]{4}){3}$/);
      // Direkt darueber eine Begruendung (Kommentar) oder eine weitere
      // Kennung desselben Absatzes
      const i = text.findIndex((z) => z.trim() === `- ${ghsa}`);
      expect(i, ghsa).toBeGreaterThan(0);
      expect(text[i - 1].trim(), ghsa).toMatch(/^(#|- GHSA-)/);
      // Dieselbe Luecke eng in .trivyignore.yaml
      expect(
        statements.some((s) => s.includes(ghsa)),
        ghsa,
      ).toBe(true);
    }
  });

  it("CI e2e: dieselben Images wie docker-compose.yml", () => {
    const dienste = ci().jobs.e2e?.services ?? {};
    const c = compose().services;
    expect(dienste.postgres?.image).toBe(c.db?.image);
    expect(dienste.redis?.image).toBe(c.redis?.image);
    expect(c.db?.image).toBeTruthy();
    expect(c.redis?.image).toBeTruthy();
  });
});
