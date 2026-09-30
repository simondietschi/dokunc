// Prueft den Titel eines Pull-Requests gegen Conventional Commits 1.0.0
// (CONTRIBUTING.md). Der Titel wird zum Betreff des Commits auf main.
// Aufruf in .github/workflows/pr-title.yml mit PR_TITLE und PR_AUTHOR in
// der Umgebung; Tests: apps/web/src/konventionen.test.ts.
// Meldungen englisch: sie richten sich an Beitragende (CONTRIBUTING.md).
// Reines ESM ohne Abhaengigkeiten, laeuft mit dem Node des Runners.
import { pathToFileURL } from "node:url";

export const TYPEN = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
];
export const MAX_LAENGE = 100;

// Dependabot kuerzt seine Titel nicht: ein einzelnes Update in einer
// Gruppe ("bump eslint-plugin-react-hooks from 7.1.1 to 7.2.0 in the
// eslint group across 1 directory") kommt mit Praefix auf 106 Zeichen,
// mit "[security]" auf 110. Fuer ihn entfaellt nur die Laengengrenze.
const OHNE_LAENGENGRENZE = new Set(["dependabot[bot]"]);

const KOPF = /^(?<typ>[^():!\s]+)(?:\((?<bereich>[^()]*)\))?(?<bruch>!)?: (?<text>.*)$/;
const BEREICH = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Meldungen zum Titel, leer, wenn er passt. Geprueft werden Laenge (in
 * Codepoints), GitHubs Revert-Titel, die Form, der Typ, der Bereich und
 * die Beschreibung, nicht die Sprache.
 * @param {string} titel
 * @param {{ autor?: string }} [optionen]
 * @returns {string[]}
 */
export function pruefeTitel(titel, optionen = {}) {
  const fehler = [];
  const laenge = [...titel].length;
  if (laenge > MAX_LAENGE && !OHNE_LAENGENGRENZE.has(optionen.autor ?? "")) {
    fehler.push(`The title has ${laenge} characters; keep it at ${MAX_LAENGE} or fewer.`);
  }
  if (/^Revert "/.test(titel)) {
    fehler.push(`Rename GitHub's revert title to "revert: <title of the reverted pull request>".`);
    return fehler;
  }
  const m = KOPF.exec(titel);
  if (!m?.groups) {
    fehler.push(
      'The title must look like "<type>(<scope>): <description>", for example "fix(editor): keep the caret after paste".',
    );
    return fehler;
  }
  const { typ, bereich, text } = m.groups;
  if (!TYPEN.includes(typ)) {
    fehler.push(`Unknown type "${typ}". Use one of: ${TYPEN.join(", ")}.`);
  }
  if (bereich !== undefined && !BEREICH.test(bereich)) {
    fehler.push(
      `The scope "${bereich}" must be lowercase letters, digits and hyphens, for example "web" or "deps".`,
    );
  }
  if (text.trim() === "") fehler.push("The description after the colon is missing.");
  else if (text !== text.trim()) fehler.push("The description must not start or end with a space.");
  else if (text.endsWith(".")) fehler.push("The description must not end with a full stop.");
  return fehler;
}

/**
 * Daten eines Workflow-Befehls maskieren, wie @actions/core es tut. Die
 * Meldungen enthalten nur gepruefte Teile des Titels, nie den ganzen;
 * maskiert kann auch ein Typ wie "fe%0Aat" keine neue Zeile und damit
 * keinen eigenen Workflow-Befehl bilden.
 * @param {string} s
 */
function maskiere(s) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fehler = pruefeTitel(process.env.PR_TITLE ?? "", { autor: process.env.PR_AUTHOR });
  for (const f of fehler) console.log(`::error title=Pull request title::${maskiere(f)}`);
  if (fehler.length > 0) {
    console.log('See CONTRIBUTING.md, section "Commit messages".');
    process.exitCode = 1;
  } else {
    console.log("The pull request title follows Conventional Commits.");
  }
}
