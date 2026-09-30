import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * Inventar der Endpunkte aus dem Quelltext: jede Server Action und jeder
 * Route-Handler unter apps/web/src, als Schlüssel der Rechtematrix.
 *
 *   action:app/s/[slug]/actions.ts#purgePageAction
 *   route:app/api/pages/[id]/export/route.ts#GET
 *
 * Datei und Name, weil derselbe Name in zwei Dateien vorkommt
 * (deleteSpaceAction). Reines Lesen von Dateien, ohne Next und ohne
 * Datenbank. Gelesen wird mit dem Parser von TypeScript statt zeilenweise:
 * ein Kommentar neben der Direktive, zwei Exporte in einer Zeile oder ein
 * Export über mehrere Zeilen täuschen so das Inventar nicht.
 *
 * Was sich nicht sicher lesen lässt, wirft: jede andere Exportform in
 * einer "use server"-Datei oder einer route-Datei wäre ein aufrufbarer
 * Endpunkt, den das Inventar übersähe, und damit ein Weg am Meta-Test
 * vorbei.
 */

const DIREKTIVE = "use server";
const HTTP_METHODEN = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/**
 * Exporte einer route-Datei, die keine Handler sind: die
 * Segment-Konfiguration von Next und generateStaticParams. Jeder andere
 * Name wirft; wer einen weiteren braucht, trägt ihn hier ein.
 */
const ROUTEN_KONFIGURATION = new Set([
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "generateStaticParams",
  "maxDuration",
  "preferredRegion",
  "revalidate",
  "runtime",
]);

/** Route-Handler, mit den Standard-Endungen von Next (pageExtensions). */
const ROUTEN_DATEI = /^app\/(?:.*\/)?route\.(?:ts|tsx|js|jsx)$/;

/**
 * Dateien, aus denen Next ebenfalls Endpunkte baut, die das Inventar aber
 * nicht liest: Metadaten-Routen mit Code und der Pages-Router. Sie werfen,
 * bis die Matrix sie kennt.
 */
const UNGELESENE_ENDPUNKTE =
  /^(?:app\/(?:.*\/)?(?:sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\d*\.(?:ts|tsx|js|jsx)|pages\/.*)$/;

const UMLENKUNG =
  'Wieder- oder Standardexport in einer route-Datei; Handler direkt als "export async function GET(" schreiben';

function skriptArt(datei: string): ts.ScriptKind {
  if (datei.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (datei.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.m?js$/.test(datei)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parse(datei: string, text: string): ts.SourceFile {
  return ts.createSourceFile(datei, text, ts.ScriptTarget.Latest, true, skriptArt(datei));
}

/** "datei:zeile" einer Anweisung, Zeile 1-basiert, ohne führende Kommentare. */
function ort(datei: string, sf: ts.SourceFile, knoten: ts.Node): string {
  return `${datei}:${sf.getLineAndCharacterOfPosition(knoten.getStart(sf)).line + 1}`;
}

/** Erste Zeile einer Anweisung, für Fehlermeldungen. */
function auszug(sf: ts.SourceFile, knoten: ts.Node): string {
  const erste = knoten.getText(sf).split("\n")[0].trim();
  return erste.length > 80 ? `${erste.slice(0, 77)}...` : erste;
}

function istDirektive(knoten: ts.Node): boolean {
  return (
    ts.isExpressionStatement(knoten) &&
    ts.isStringLiteral(knoten.expression) &&
    knoten.expression.text === DIREKTIVE
  );
}

/** Der Prolog: die Zeichenketten-Anweisungen am Anfang der Datei. */
function prolog(sf: ts.SourceFile): ts.Statement[] {
  const aus: ts.Statement[] = [];
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break;
    aus.push(s);
  }
  return aus;
}

function hatModifikator(knoten: ts.Node, art: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(knoten) &&
    (ts.getModifiers(knoten) ?? []).some((m) => m.kind === art)
  );
}

const istExportiert = (s: ts.Statement) => hatModifikator(s, ts.SyntaxKind.ExportKeyword);
const istStandard = (s: ts.Statement) => hatModifikator(s, ts.SyntaxKind.DefaultKeyword);

/** Typen erzeugen keinen Endpunkt. */
function istTyp(s: ts.Statement): boolean {
  return (
    ts.isTypeAliasDeclaration(s) ||
    ts.isInterfaceDeclaration(s) ||
    (ts.isExportDeclaration(s) && s.isTypeOnly)
  );
}

/** Jede Anweisung, die etwas aus der Datei herausgibt. */
function istExport(s: ts.Statement): boolean {
  return istExportiert(s) || ts.isExportDeclaration(s) || ts.isExportAssignment(s);
}

/** Steht die Direktive "use server" im Prolog der Datei? */
function hatDateiDirektive(sf: ts.SourceFile): boolean {
  return prolog(sf).some(istDirektive);
}

/** Wirft bei einer Direktive "use server" ausserhalb des Datei-Prologs. */
function pruefeDirektivenOrte(datei: string, sf: ts.SourceFile): void {
  const imProlog = new Set<ts.Node>(prolog(sf));
  const besuche = (knoten: ts.Node): void => {
    if (istDirektive(knoten) && !imProlog.has(knoten)) {
      throw new Error(
        knoten.parent === sf
          ? `${ort(datei, sf, knoten)}: Direktive 'use server' nicht am Dateianfang: vor alle Importe stellen`
          : `${ort(datei, sf, knoten)}: Inline-Server-Action: in eine Datei mit 'use server' auslagern`,
      );
    }
    ts.forEachChild(knoten, besuche);
  };
  ts.forEachChild(sf, besuche);
}

function actionsAusDatei(datei: string, sf: ts.SourceFile): string[] {
  // Eine Menge: Überladungen tragen denselben Namen wie ihre Umsetzung.
  const namen = new Set<string>();
  for (const s of sf.statements) {
    if (!istExport(s) || istTyp(s)) continue;
    if (ts.isFunctionDeclaration(s) && s.name && !istStandard(s)) {
      namen.add(s.name.text);
      continue;
    }
    throw new Error(
      `${ort(datei, sf, s)}: Exportform in einer "use server"-Datei nicht lesbar ` +
        `("${auszug(sf, s)}"). Erlaubt sind "export async function Name(", ` +
        `"export function Name(", "export type" und "export interface".`,
    );
  }
  return [...namen].map((n) => `action:${datei}#${n}`);
}

function routenAusDatei(datei: string, sf: ts.SourceFile): string[] {
  const methoden = new Set<string>();
  const wirf = (s: ts.Statement, grund: string): never => {
    throw new Error(`${ort(datei, sf, s)}: ${grund} ("${auszug(sf, s)}").`);
  };
  const nimm = (s: ts.Statement, name: string): void => {
    if (HTTP_METHODEN.has(name)) methoden.add(name);
    else if (!ROUTEN_KONFIGURATION.has(name)) {
      wirf(s, `Export "${name}" ist weder Handler noch Segment-Konfiguration`);
    }
  };
  for (const s of sf.statements) {
    if (!istExport(s) || istTyp(s)) continue;
    // Ein Handler aus einer anderen Datei wäre hier nicht zu sehen.
    if (ts.isExportDeclaration(s) || ts.isExportAssignment(s) || istStandard(s)) {
      wirf(s, UMLENKUNG);
    }
    if (ts.isFunctionDeclaration(s) && s.name) {
      nimm(s, s.name.text);
    } else if (ts.isVariableStatement(s)) {
      if (!(s.declarationList.flags & ts.NodeFlags.Const)) {
        wirf(s, 'Export mit "let" oder "var" in einer route-Datei; "export const" schreiben');
      }
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) {
          wirf(
            s,
            'Destrukturierender Export in einer route-Datei; jeden Handler einzeln als "export const GET =" schreiben',
          );
        } else {
          nimm(s, d.name.text);
        }
      }
    } else {
      wirf(s, "Exportform in einer route-Datei nicht lesbar");
    }
  }
  return [...methoden].map((m) => `route:${datei}#${m}`);
}

/** Steht die Direktive "use server" im Prolog der Datei? */
export function istServerActionDatei(text: string, datei = "datei.ts"): boolean {
  return hatDateiDirektive(parse(datei, text));
}

/**
 * Wirft bei einer Direktive "use server", die nicht im Prolog der Datei
 * steht: eine Action im Funktionskörper stünde in keinem Inventar, und
 * eine Direktive nach den Importen macht die Datei nicht zur Action-Datei.
 */
export function pruefeInlineDirektiven(datei: string, text: string): void {
  pruefeDirektivenOrte(datei, parse(datei, text));
}

/** Schlüssel der Actions einer "use server"-Datei; wirft bei anderen Exportformen. */
export function actionsAusQuelltext(datei: string, text: string): string[] {
  return actionsAusDatei(datei, parse(datei, text));
}

/**
 * Schlüssel der Handler einer route-Datei; wirft bei jedem Export, der
 * weder Handler noch Typ noch Segment-Konfiguration ist.
 */
export function routenAusQuelltext(datei: string, text: string): string[] {
  return routenAusDatei(datei, parse(datei, text));
}

function endpunkteAusQuelltext(datei: string, text: string): string[] {
  if (UNGELESENE_ENDPUNKTE.test(datei)) {
    throw new Error(
      `${datei}: Next baut aus dieser Datei einen Endpunkt, den das Inventar nicht liest; ` +
        "als route-Datei schreiben oder test/rechtematrix/inventar.ts erweitern",
    );
  }
  const sf = parse(datei, text);
  pruefeDirektivenOrte(datei, sf);
  const schluessel: string[] = [];
  if (hatDateiDirektive(sf)) schluessel.push(...actionsAusDatei(datei, sf));
  if (ROUTEN_DATEI.test(datei)) schluessel.push(...routenAusDatei(datei, sf));
  return schluessel;
}

function dateienUnter(dir: string): string[] {
  const aus: string[] = [];
  for (const eintrag of readdirSync(dir, { withFileTypes: true })) {
    const pfad = join(dir, eintrag.name);
    if (eintrag.isDirectory()) aus.push(...dateienUnter(pfad));
    else aus.push(pfad);
  }
  return aus;
}

const posix = (p: string) => p.split(sep).join("/");

/**
 * Alle Endpunkte unter `srcDir` (apps/web/src), sortiert. Wirft bei
 * einer Datei, die sich nicht sicher lesen lässt.
 */
export function inventar(srcDir: string): string[] {
  const schluessel: string[] = [];
  for (const pfad of dateienUnter(srcDir)) {
    const datei = posix(relative(srcDir, pfad));
    if (!/\.(?:ts|tsx|js|jsx|mjs)$/.test(datei)) continue;
    schluessel.push(...endpunkteAusQuelltext(datei, readFileSync(pfad, "utf8")));
  }
  return schluessel.sort();
}
