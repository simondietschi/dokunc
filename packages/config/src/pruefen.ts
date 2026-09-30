import type { Umgebung, Variable } from "./variable";

export type Befund = { variable: string; meldung: string };

export type Pruefbericht = {
  ok: boolean;
  /** Wirksame Werte aller geprueften Variablen; leer, wenn nicht ok. */
  werte: Record<string, unknown>;
  fehler: Befund[];
  hinweise: Befund[];
};

/** Jede Meldung beginnt mit dem Namen der Variable. */
function mitName(name: string, meldung: string): string {
  return meldung.startsWith(name) ? meldung : `${name}: ${meldung}`;
}

function alsText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Prueft die Umgebung gegen die Variablen, die `dienst` liest.
 *
 * Sammelt alle Probleme eines Laufs, nie nur das erste: zuerst parst
 * jede Variable fuer sich, danach laeuft jede Querpruefung, deren
 * Eingaben gueltig sind. Ein Feldfehler in LOG_LEVEL unterdrueckt also
 * keine Querpruefung einer anderen Variable.
 *
 * Rohwerte geheimer Variablen ersetzt der Mechanismus in allen Meldungen
 * durch ***, auch wenn ein Parser sie versehentlich nennt. Ein Parser
 * oder eine Querpruefung, die wirft, wird zu einem Fehler der Variable
 * statt zu einem Absturz.
 */
export function checkEnvironment(
  variablen: readonly Variable[],
  env: Umgebung,
  dienst: "web" | "collab",
): Pruefbericht {
  const eigene = variablen.filter((v) => v.dienste.includes(dienst));
  const fehler: Befund[] = [];
  const hinweise: Befund[] = [];
  const werte: Record<string, unknown> = {};
  const kaputt = new Set<string>();

  for (const v of eigene) {
    let ergebnis: ReturnType<Variable["parse"]>;
    try {
      ergebnis = v.parse(env[v.name], env);
    } catch (e) {
      ergebnis = { ok: false, fehler: `Pruefung fehlgeschlagen: ${alsText(e)}` };
    }
    if (!ergebnis.ok) {
      kaputt.add(v.name);
      fehler.push({ variable: v.name, meldung: mitName(v.name, ergebnis.fehler) });
      continue;
    }
    werte[v.name] = ergebnis.wert;
    for (const h of ergebnis.hinweise ?? []) {
      hinweise.push({ variable: v.name, meldung: mitName(v.name, h) });
    }
  }

  for (const v of eigene) {
    const q = v.querpruefung;
    if (!q || kaputt.has(v.name) || q.liest.some((n) => kaputt.has(n))) continue;
    let ausgang: { fehler?: string[]; hinweise?: string[] };
    try {
      ausgang = q.pruefe(werte[v.name], werte, env);
    } catch (e) {
      ausgang = { fehler: [`Pruefung fehlgeschlagen: ${alsText(e)}`] };
    }
    for (const f of ausgang.fehler ?? []) {
      fehler.push({ variable: v.name, meldung: mitName(v.name, f) });
    }
    for (const h of ausgang.hinweise ?? []) {
      hinweise.push({ variable: v.name, meldung: mitName(v.name, h) });
    }
  }

  const maske = geheimeRohwerte(variablen, env);
  const schwaerzen = (b: Befund): Befund => ({ ...b, meldung: ohneGeheimes(b.meldung, maske) });
  const ok = fehler.length === 0;
  return {
    ok,
    werte: ok ? werte : {},
    fehler: fehler.map(schwaerzen),
    hinweise: hinweise.map(schwaerzen),
  };
}

/** Rohwerte aller geheimen Variablen, laengste zuerst. */
function geheimeRohwerte(variablen: readonly Variable[], env: Umgebung): string[] {
  const werte = new Set<string>();
  for (const v of variablen) {
    if (!v.geheim) continue;
    const roh = env[v.name];
    if (roh === undefined) continue;
    for (const w of [roh, roh.trim()]) if (w !== "") werte.add(w);
  }
  return [...werte].sort((a, b) => b.length - a.length);
}

function ohneGeheimes(text: string, geheim: readonly string[]): string {
  return geheim.reduce((t, w) => t.split(w).join("***"), text);
}
