import { headingSlug } from "@dokunc/editor";

/**
 * Reine Logik fuer das Inhaltsverzeichnis: Ueberschriften aus einem
 * ProseMirror-Dokument einsammeln, ihre Anker bilden und die beim
 * Scrollen aktive Ueberschrift bestimmen.
 */

export type TocHeading = {
  /** Dokumentposition des Heading-Knotens. */
  pos: number;
  level: number;
  text: string;
};

/** Minimale Sicht auf ein ProseMirror-Dokument (testbar ohne Schema). */
export type HeadingDocLike = {
  descendants(
    cb: (
      node: {
        type: { name: string };
        attrs: Record<string, unknown>;
        textContent: string;
      },
      pos: number,
    ) => boolean | void,
  ): void;
};

const TOC_MAX_LEVEL = 3;

/**
 * Alle Ueberschriften (Ebene 1 bis 3) in Dokumentreihenfolge.
 *
 * Die EINE Stelle, an der die Ueberschriften einer Seite eingesammelt
 * werden (components/editor/TableOfContents). Frueher gab es daneben
 * einen zweiten Streifen mit eigener Sammlung; auf breiten Schirmen
 * standen dann zwei verschieden lange Listen derselben Seite.
 *
 * Leere Ueberschriften fallen raus: eine Zeile ohne Text waere ein
 * unbeschrifteter Eintrag, der nirgendwohin fuehrt.
 */
export function collectHeadings(doc: HeadingDocLike): TocHeading[] {
  const out: TocHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level);
    if (!Number.isFinite(level) || level < 1 || level > TOC_MAX_LEVEL) return;
    const text = node.textContent.trim();
    if (!text) return;
    out.push({ pos, level, text });
  });
  return out;
}

/**
 * Index der aktiven Ueberschrift: die letzte, deren Oberkante die
 * Schwelle (Sticky-Header-Hoehe plus Puffer) erreicht oder ueberschritten
 * hat. Vor der ersten Ueberschrift ist die erste aktiv. `tops` sind die
 * Oberkanten relativ zum Scroll-Container in Dokumentreihenfolge.
 * Ist der Container bis zum Ende gescrollt (`atEnd`), gilt die letzte
 * Ueberschrift als aktiv — auch wenn sie die Schwelle nie erreichen kann,
 * weil darunter zu wenig Inhalt folgt.
 */
export function activeHeadingIndex(
  tops: number[],
  threshold: number,
  atEnd = false,
): number {
  if (atEnd && tops.length > 0) return tops.length - 1;
  let active = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= threshold) active = i;
    else break;
  }
  return active;
}

/**
 * Anker einer Ueberschrift, etwa `#erste-schritte`.
 *
 * Dieselbe Funktion vergibt die id der Ueberschrift (packages/editor
 * AnchoredHeading): im HTML-Export beim Rendern, im Editor laufend, also
 * auch waehrend getippt wird. Ein Eintrag im Verzeichnis ist damit ein
 * echter Link. Oeffnet ihn jemand in einem neuen Tab oder aus einer
 * geteilten Adresse, gibt es die Ueberschrift beim Laden noch nicht (der
 * Inhalt kommt erst mit dem Collab-Abgleich); den Sprung holt dann das
 * Verzeichnis nach (siehe `headingForHash`).
 */
export function headingHref(heading: Pick<TocHeading, "text">): string {
  return `#${headingSlug(heading.text)}`;
}

/**
 * Die Ueberschrift, auf die der Anker einer Adresse zeigt (`location.hash`),
 * oder `null`.
 *
 * Der Browser springt beim Laden selbst zum Anker, findet dort aber nichts:
 * der Seiteninhalt wird nicht auf dem Server gerendert und steht erst
 * nach dem ersten Abgleich mit dem Collab-Server im Dokument. Das
 * Verzeichnis springt deshalb danach selbst, mit derselben Bewegung wie
 * beim Klick. Gleich benannte Ueberschriften teilen sich den Anker; wie
 * der Browser nimmt diese Funktion dann die erste. Gesucht wird unter
 * den Eintraegen des Verzeichnisses (Ebene 1 bis 3), denn nur auf die
 * fuehren seine Links.
 */
export function headingForHash(
  headings: readonly TocHeading[],
  hash: string,
): TocHeading | null {
  let ziel = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    ziel = decodeURIComponent(ziel);
  } catch {
    // Kaputte Prozentkodierung: dann eben woertlich vergleichen.
  }
  if (!ziel) return null;
  return headings.find((h) => headingHref(h) === `#${ziel}`) ?? null;
}

/**
 * Viewport-Breite, ab der das Verzeichnis ueber dem Text ohne
 * gespeicherte Vorliebe aufgeklappt ist.
 *
 * Bis zu dieser Schwelle stand frueher neben dem Text ein zweiter,
 * immer offener Streifen ("Gliederung", ab 1400px Viewport). Er ist
 * zugunsten dieses einen Verzeichnisses entfallen; begaenne der Block
 * dort zugeklappt, saehe man bei gaengigen Laptop-Breiten (etwa 1440px)
 * statt der Liste nur noch den Umschalter.
 */
export const TOC_OPEN_MEDIA_QUERY = "(min-width: 1400px)";

/**
 * Gespeicherte Vorliebe fuer den Block lesen: "1" auf, "0" zu, alles
 * andere (auch nichts) heisst: nie umgeschaltet.
 */
export function parseStoredOpen(value: string | null): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

/**
 * Ist der Block ueber dem Text aufgeklappt? Wer ihn einmal umgeschaltet
 * hat, behaelt seine Wahl bei jeder Breite. Sonst entscheidet die Breite
 * (`wide` = TOC_OPEN_MEDIA_QUERY trifft zu).
 */
export function tocOpen(stored: boolean | null, wide: boolean): boolean {
  return stored ?? wide;
}

/** Was von einem Mausklick fuer die Entscheidung unten zaehlt. */
export type ClickLike = {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

/**
 * Behandelt die Seite diesen Klick auf einen Verzeichnis-Eintrag selbst?
 *
 * Nur der schlichte Linksklick springt im Editor (mit Abstand zum
 * Sticky-Kopf und Cursor in der Ueberschrift). Mit Strg, Cmd, Umschalt
 * oder Alt oder mit der mittleren Taste will der Nutzer, was der Browser
 * mit einem Link tut: neuer Tab, neues Fenster, Link speichern. Das darf
 * der eigene Sprung nicht abfangen, sonst waere der Anker nur Zierde.
 */
export function isPlainClick(e: ClickLike): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !e.altKey
  );
}
