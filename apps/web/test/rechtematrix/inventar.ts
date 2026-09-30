import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Inventar der Endpunkte aus dem Quelltext: jede Server Action und jeder
 * Route-Handler unter apps/web/src, als Schlüssel der Rechtematrix.
 *
 *   action:app/s/[slug]/actions.ts#purgePageAction
 *   route:app/api/pages/[id]/export/route.ts#GET
 *
 * Datei und Name, weil derselbe Name in zwei Dateien vorkommt
 * (deleteSpaceAction). Reines Lesen von Dateien, ohne Next und ohne
 * Datenbank.
 *
 * Was sich nicht sicher lesen lässt, wirft: jede andere Exportform in
 * einer "use server"-Datei wäre ein aufrufbarer Endpunkt, den das
 * Inventar übersähe, und damit ein Weg am Meta-Test vorbei.
 */

const DIREKTIVE = /^["']use server["'];?\s*$/;
const HTTP_METHODEN = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

/** Erste Anweisung nach Leerzeilen und Kommentaren: Zeilennummer (0-basiert) oder -1. */
function ersteAnweisung(zeilen: readonly string[]): number {
  let imBlock = false;
  for (let i = 0; i < zeilen.length; i++) {
    let z = zeilen[i].trim();
    while (z) {
      if (imBlock) {
        const ende = z.indexOf("*/");
        if (ende < 0) break;
        imBlock = false;
        z = z.slice(ende + 2).trim();
        continue;
      }
      if (z.startsWith("//")) break;
      if (z.startsWith("/*")) {
        imBlock = true;
        z = z.slice(2);
        continue;
      }
      return i;
    }
  }
  return -1;
}

/** Ist die erste Anweisung der Datei die Direktive "use server"? */
export function istServerActionDatei(text: string): boolean {
  const zeilen = text.split("\n");
  const erste = ersteAnweisung(zeilen);
  return erste >= 0 && DIREKTIVE.test(zeilen[erste].trim());
}

/**
 * Wirft bei einer Direktive "use server", die nicht die erste Anweisung
 * der Datei ist: eine Action im Funktionskörper stünde in keinem
 * Inventar.
 */
export function pruefeInlineDirektiven(datei: string, text: string): void {
  const zeilen = text.split("\n");
  const erste = ersteAnweisung(zeilen);
  zeilen.forEach((zeile, i) => {
    if (i === erste) return;
    if (DIREKTIVE.test(zeile.trim())) {
      throw new Error(
        `${datei}:${i + 1}: Inline-Server-Action: in eine Datei mit 'use server' auslagern`,
      );
    }
  });
}

/** Schlüssel der Actions einer "use server"-Datei; wirft bei anderen Exportformen. */
export function actionsAusQuelltext(datei: string, text: string): string[] {
  const schluessel: string[] = [];
  text.split("\n").forEach((zeile, i) => {
    if (!/^\s*export\b/.test(zeile)) return;
    const fn = zeile.match(
      /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/,
    );
    if (fn) {
      schluessel.push(`action:${datei}#${fn[1]}`);
      return;
    }
    // Typen erzeugen keinen Endpunkt.
    if (/^\s*export\s+(?:type|interface)\b/.test(zeile)) return;
    throw new Error(
      `${datei}:${i + 1}: Exportform in einer "use server"-Datei nicht lesbar ` +
        `("${zeile.trim()}"). Erlaubt sind "export async function Name(", ` +
        `"export function Name(", "export type" und "export interface".`,
    );
  });
  return schluessel;
}

/** Schlüssel der Handler einer route.ts; wirft bei Wieder- und Standardexporten. */
export function routenAusQuelltext(datei: string, text: string): string[] {
  const schluessel: string[] = [];
  text.split("\n").forEach((zeile, i) => {
    if (!/^\s*export\b/.test(zeile)) return;
    const handler =
      zeile.match(
        new RegExp(`^\\s*export\\s+(?:async\\s+)?function\\s+(${HTTP_METHODEN})\\b`),
      ) ??
      zeile.match(new RegExp(`^\\s*export\\s+const\\s+(${HTTP_METHODEN})\\b`));
    if (handler) {
      schluessel.push(`route:${datei}#${handler[1]}`);
      return;
    }
    // Ein Handler aus einer anderen Datei wäre hier nicht zu sehen.
    if (/^\s*export\s*(?:\{|\*|default\b)/.test(zeile)) {
      throw new Error(
        `${datei}:${i + 1}: Wieder- oder Standardexport in einer route.ts ` +
          `("${zeile.trim()}"). Handler direkt als "export async function GET(" schreiben.`,
      );
    }
    // Übrige Exporte (runtime, maxDuration, dynamic, Typen) sind keine Handler.
  });
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
    const text = readFileSync(pfad, "utf8");
    pruefeInlineDirektiven(datei, text);
    if (istServerActionDatei(text)) {
      schluessel.push(...actionsAusQuelltext(datei, text));
    }
    if (/^app\/(?:.*\/)?route\.(?:ts|js)$/.test(datei)) {
      schluessel.push(...routenAusQuelltext(datei, text));
    }
  }
  return schluessel.sort();
}
