import type { Ergebnis } from "./ergebnis";

/**
 * Wer eine Variable liest: die beiden Server-Prozesse, Docker Compose
 * selbst, der Proxy (Caddy) oder ein Skript (Prisma-CLI, Sicherung).
 * Geprueft beim Start werden nur Variablen von web und collab.
 */
export type Dienst = "web" | "collab" | "compose" | "proxy" | "skript";

export type Umgebung = Readonly<Record<string, string | undefined>>;

export interface Variable<T = unknown> {
  /** Form `^[A-Z][A-Z0-9_]*$`. */
  name: string;
  dienste: readonly Dienst[];
  /** Englisch, fuer die Konfigurationsreferenz. */
  beschreibung: string;
  /** Wirksamer Wert, wenn die Variable leer ist (nur Anzeige). */
  vorgabe?: string;
  /** Der Wert erscheint nie, weder im Startlog noch in Meldungen. */
  geheim?: boolean;
  /** Steht unter `app.environment` in docker-compose.yml. Vorgabe: ja, wenn web oder collab sie liest. */
  inCompose?: boolean;
  /** Rohwert (undefined oder Text) → wirksamer Wert. */
  parse: (roh: string | undefined, env: Umgebung) => Ergebnis<T>;
  /**
   * Prueft den Wert gegen andere Variablen. Laeuft je Variable nach dem
   * Parsen aller Felder; uebersprungen nur, wenn diese Variable oder eine
   * in `liest` genannte einen Feldfehler hat. `fehler` beenden den Start,
   * `hinweise` warnen.
   */
  querpruefung?: {
    liest: readonly string[];
    pruefe(
      wert: T,
      werte: Readonly<Record<string, unknown>>,
      env: Umgebung,
    ): { fehler?: string[]; hinweise?: string[] };
  };
  /** Wert fuer das Startlog, falls er vom geparsten abweicht. */
  anzeige?(wert: T, env: Umgebung): unknown;
}

const NAME = /^[A-Z][A-Z0-9_]*$/;

/** Deklariert eine Variable; ein ungueltiger Name wirft schon beim Laden. */
export function defineVariable<T>(v: Variable<T>): Variable<T> {
  if (!NAME.test(v.name)) {
    throw new Error(`Ungueltiger Variablenname "${v.name}" (erwartet ${NAME.source})`);
  }
  return v;
}

/** "a, b oder c" */
export function aufzaehlung(werte: readonly string[]): string {
  if (werte.length <= 1) return werte.join("");
  return `${werte.slice(0, -1).join(", ")} oder ${werte[werte.length - 1]}`;
}

/**
 * Parser fuer eine feste Auswahl: getrimmt, Gross/klein egal, leer oder
 * nicht gesetzt ergibt die Vorgabe. Liefert den Wert so geschrieben wie
 * in `werte`.
 */
export function auswahl<const W extends string>(
  werte: readonly W[],
  vorgabe: W,
  name: string,
): Variable<W>["parse"] {
  return (roh) => {
    const text = (roh ?? "").trim();
    if (text === "") return { ok: true, wert: vorgabe };
    const treffer = werte.find((w) => w.toLowerCase() === text.toLowerCase());
    if (treffer !== undefined) return { ok: true, wert: treffer };
    return { ok: false, fehler: `${name} kennt nur ${aufzaehlung(werte)}: "${roh}"` };
  };
}

/**
 * Parser fuer eine ganze Zahl in einem Bereich: getrimmt, leer oder nicht
 * gesetzt ergibt die Vorgabe. Keine Nachkommastellen, keine Einheiten.
 */
export function ganzeZahl(o: {
  min: number;
  max: number;
  vorgabe: number;
  name: string;
}): Variable<number>["parse"] {
  return (roh) => {
    const text = (roh ?? "").trim();
    if (text === "") return { ok: true, wert: o.vorgabe };
    const zahl = /^[+-]?\d+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isSafeInteger(zahl) || zahl < o.min || zahl > o.max) {
      return {
        ok: false,
        fehler: `${o.name} erwartet eine ganze Zahl von ${o.min} bis ${o.max}: "${roh}"`,
      };
    }
    return { ok: true, wert: zahl };
  };
}
