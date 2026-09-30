import {
  AKTEURE,
  INVARIANTEN_NAMEN,
  LUECKEN_KENNUNGEN,
  type Eintrag,
  type Szenario,
  type Zelle,
} from "./erwartung";

/**
 * Regeln der Erwartungsdatei, als reine Funktion: sie bekommt Inventar,
 * Erwartung und einen Dateileser und gibt die Verstösse als Text zurück.
 * Der Meta-Test ruft sie mit den echten Daten auf (keine Verstösse) und
 * mit ausgedachten, damit jede Regel nachweislich anschlägt.
 */

export type PruefEingabe = {
  inventar: readonly string[];
  erwartung: Readonly<Record<string, Eintrag>>;
  offenBestand: readonly string[];
  /** Inhalt einer Datei, Pfad ab Repo-Wurzel; null, wenn es sie nicht gibt. */
  dateiText: (pfadAbRepo: string) => string | null;
};

/** Mindestlänge der Begründung für eine Route ohne Anmeldung. */
export const OEFFENTLICH_MIN_GRUND = 20;

function erwartet(z: Zelle): string {
  return typeof z === "string" ? z : z.erwartet;
}

/**
 * Der Pfad, unter dem eine Route aufgerufen wird: Routengruppen in
 * Klammern fallen weg, dynamische Segmente passen auf jedes Segment
 * ohne Schrägstrich (`${id}` in einem Test genauso wie eine echte ID).
 */
export function routenMuster(schluessel: string): RegExp {
  const datei = schluessel.slice("route:".length, schluessel.indexOf("#"));
  const segmente = datei
    .replace(/^app\//, "")
    .replace(/\/?route\.(?:ts|js)$/, "")
    .split("/")
    .filter((s) => s && !/^\(.*\)$/.test(s));
  const teile = segmente.map((s) =>
    /^\[.*\]$/.test(s)
      ? "[^/\\s\"'`]+"
      : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`/${teile.join("/")}(?![\\w-])`);
}

export function pruefeErwartung(e: PruefEingabe): string[] {
  const fehler: string[] = [];
  const schluessel = Object.keys(e.erwartung);
  const inventar = new Set(e.inventar);
  const offen = new Set(e.offenBestand);

  // 1. Inventar = Schlüssel der Erwartung, in beide Richtungen.
  for (const k of e.inventar) {
    if (!(k in e.erwartung)) {
      fehler.push(
        `${k}: neue Action/Route ohne Eintrag in test/rechtematrix/erwartung.ts`,
      );
    }
  }
  for (const k of schluessel) {
    if (!inventar.has(k)) {
      fehler.push(`${k}: veralteter Eintrag, die Action/Route gibt es nicht mehr`);
    }
  }
  // Sortiert, damit parallele Änderungen an verschiedenen Stellen landen.
  for (let i = 1; i < schluessel.length; i++) {
    if (schluessel[i - 1] >= schluessel[i]) {
      fehler.push(
        `ERWARTUNG ist nicht nach Schlüssel sortiert: "${schluessel[i - 1]}" vor "${schluessel[i]}"`,
      );
    }
  }

  // 2. offen ⇔ in OFFEN_BESTAND.
  for (const k of e.offenBestand) {
    if (e.erwartung[k]?.stand !== "offen") {
      fehler.push(
        `${k}: steht in OFFEN_BESTAND, ist aber nicht (mehr) offen; aus OFFEN_BESTAND streichen`,
      );
    }
  }

  for (const [k, eintrag] of Object.entries(e.erwartung)) {
    switch (eintrag.stand) {
      case "offen":
        if (!offen.has(k)) {
          fehler.push(
            `${k}: ein neuer Eintrag darf nicht offen sein, er braucht Fälle ` +
              `(geprueft), einen eigenen Test (extern) oder ist öffentlich`,
          );
        }
        break;
      case "geprueft":
        fehler.push(...pruefeSzenarien(k, eintrag.szenarien));
        break;
      case "extern":
        fehler.push(...pruefeExtern(k, eintrag.tests, e.dateiText));
        break;
      case "oeffentlich":
        if (!k.startsWith("route:")) {
          fehler.push(`${k}: "oeffentlich" gibt es nur für Routen`);
        }
        if (eintrag.grund.trim().length < OEFFENTLICH_MIN_GRUND) {
          fehler.push(
            `${k}: Begründung für "oeffentlich" zu kurz (mindestens ${OEFFENTLICH_MIN_GRUND} Zeichen)`,
          );
        }
        break;
    }
  }
  return fehler;
}

function pruefeSzenarien(
  k: string,
  szenarien: Readonly<Record<string, Szenario>>,
): string[] {
  const fehler: string[] = [];
  const namen = Object.keys(szenarien);
  if (namen.length === 0) fehler.push(`${k}: geprüft, aber ohne Szenario`);
  for (const name of namen) {
    const s = szenarien[name];
    const wo = `${k} / ${name}`;
    const akteure = Object.entries(s.akteure) as [string, Zelle][];
    for (const [a] of akteure) {
      if (!(AKTEURE as readonly string[]).includes(a)) {
        fehler.push(`${wo}: unbekannter Akteur "${a}"`);
      }
    }
    if (s.invariante && !(INVARIANTEN_NAMEN as readonly string[]).includes(s.invariante)) {
      fehler.push(`${wo}: unbekannte Invariante "${s.invariante}"`);
    }
    // 3. abgemeldet genannt, mindestens ein Akteur darf oder wird gefragt.
    if (!("abgemeldet" in s.akteure)) {
      fehler.push(`${wo}: nennt den Akteur "abgemeldet" nicht`);
    }
    if (!akteure.some(([, z]) => erwartet(z) !== "abgelehnt")) {
      fehler.push(
        `${wo}: kein Akteur mit "erlaubt" oder "bestaetigung"; ein Szenario, ` +
          `in dem niemand etwas darf, prüft keine Rolle`,
      );
    }
    // 4. Lückenzellen: heute ≠ erwartet, ausser die Lücke liegt in der
    //    Wirkung (beide "erlaubt"), dann prüft das die Invariante.
    for (const [a, z] of akteure) {
      if (typeof z === "string") continue;
      if (!(LUECKEN_KENNUNGEN as readonly string[]).includes(z.luecke)) {
        fehler.push(`${wo} / ${a}: unbekannte Lückenkennung "${z.luecke}"`);
      }
      if (z.heute === z.erwartet) {
        if (z.heute !== "erlaubt" || !s.invariante) {
          fehler.push(
            `${wo} / ${a}: Lückenzelle mit heute = erwartet ("${z.heute}"); ` +
              `die Lücke ist geschlossen, den Marker entfernen`,
          );
        }
      }
    }
  }
  return fehler;
}

function pruefeExtern(
  k: string,
  tests: readonly string[],
  dateiText: PruefEingabe["dateiText"],
): string[] {
  const fehler: string[] = [];
  if (tests.length === 0) fehler.push(`${k}: "extern" ohne Testdatei`);
  if (
    tests.length > 0 &&
    !tests.some(
      (t) => t.startsWith("apps/web/test/integration/") || t.startsWith("e2e/"),
    )
  ) {
    fehler.push(
      `${k}: "extern" braucht mindestens einen Integrations- oder E2E-Test ` +
        `(apps/web/test/integration/ oder e2e/)`,
    );
  }
  const istRoute = k.startsWith("route:");
  const name = k.slice(k.indexOf("#") + 1);
  for (const t of tests) {
    const text = dateiText(t);
    if (text === null) {
      fehler.push(`${k}: Testdatei ${t} gibt es nicht`);
      continue;
    }
    const nennt = istRoute
      ? routenMuster(k).test(text)
      : new RegExp(`\\b${name}\\b`).test(text);
    if (!nennt) {
      fehler.push(
        `${k}: ${t} nennt ${istRoute ? "den Routenpfad" : `"${name}"`} nicht`,
      );
    }
  }
  return fehler;
}
