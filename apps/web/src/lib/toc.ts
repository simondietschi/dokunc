/**
 * Reine Logik fuer das Inhaltsverzeichnis: Ueberschriften aus einem
 * ProseMirror-Dokument einsammeln und die beim Scrollen aktive
 * Ueberschrift bestimmen.
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

export const TOC_MAX_LEVEL = 3;

/** Alle Ueberschriften (Ebene 1 bis 3) in Dokumentreihenfolge. */
export function collectHeadings(doc: HeadingDocLike): TocHeading[] {
  const out: TocHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level);
    if (!Number.isFinite(level) || level < 1 || level > TOC_MAX_LEVEL) return;
    out.push({ pos, level, text: node.textContent.trim() });
  });
  return out;
}

/**
 * Index der aktiven Ueberschrift: die letzte, deren Oberkante die
 * Schwelle (Sticky-Header-Hoehe plus Puffer) erreicht oder ueberschritten
 * hat. Vor der ersten Ueberschrift ist die erste aktiv. `tops` sind die
 * Oberkanten relativ zum Scroll-Container in Dokumentreihenfolge.
 */
export function activeHeadingIndex(tops: number[], threshold: number): number {
  let active = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= threshold) active = i;
    else break;
  }
  return active;
}
