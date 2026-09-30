/**
 * Beschriftung von Wiki-Links in allem, was die App aus Seiteninhalt
 * erzeugt (Export, Druck, Freigabe, Verlauf).
 *
 * Ein Wiki-Link speichert den Titel seines Ziels als Schnappschuss
 * (`attrs.label`). Wird das Ziel später geschützt, stünde sein Titel
 * sonst weiter bei allen, die die verlinkende Seite lesen, und ein Titel
 * wie "Kündigung M. Muster" ist selbst vertraulich. Deshalb erscheint der
 * Schnappschuss nie: ein Ziel, das die lesende Person öffnen darf, bekommt
 * seinen aktuellen Titel, jedes andere einen festen Text ohne Seiten-ID.
 * Das gilt auch für gelöschte und unbekannte Ziele; eine Unterscheidung
 * verriete, dass eine geschützte Seite existiert.
 *
 * Rein und ohne Datenbank, auch im Browser verwendbar: die Titel holt der
 * Aufrufer (lib/link-titles auf dem Server, die Titel-Route im Editor).
 */

/** Anzeige für ein Ziel, das die lesende Person nicht öffnen darf. */
export const LABEL_OHNE_ZUGRIFF = "Seite ohne Zugriff";

/**
 * Neutrale Anzeige ohne Titel: Vorschauen, Ziele ausserhalb einer
 * Freigabe und Links, deren Titel der Editor gerade nicht laden kann.
 */
export const LABEL_VERKNUEPFT = "Verknüpfte Seite";

/**
 * Form einer Seiten-ID (cuid). Die Titel-Route fragt nur solche IDs ab,
 * der Editor wertet alles andere sofort als gesperrt.
 */
const SEITEN_ID = /^[a-z0-9]{8,64}$/;

export function istSeitenId(v: unknown): v is string {
  return typeof v === "string" && SEITEN_ID.test(v);
}

/** Titel je Seiten-ID; null = kein Zugriff, gelöscht oder unbekannt. */
export type LinkTitles = ReadonlyMap<string, string | null>;

export type LabelOptionen = {
  /**
   * Interne IDs entfernen: Wiki-Links werden Text ohne Verweis,
   * Erwähnungen verlieren die Personen-ID. Für alles, was die App
   * verlässt (Export, Druck, Freigabe); dort sind interne Verweise
   * wertlos oder verraten Struktur.
   */
  stripIds: boolean;
  /** Text für Ziele ohne Titel; Vorgabe LABEL_OHNE_ZUGRIFF. */
  ohneTitel?: string;
};

type JsonNode = {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
  [key: string]: unknown;
};

/**
 * Neue Kopie des Inhalts mit aufgelösten Wiki-Link-Beschriftungen. Die
 * Eingabe bleibt unverändert; was kein Objekt ist, kommt wie es war
 * zurück.
 */
export function resolveLinkLabels(
  content: unknown,
  titles: LinkTitles,
  opts: LabelOptionen,
): unknown {
  if (Array.isArray(content)) {
    return content.map((c) => resolveLinkLabels(c, titles, opts));
  }
  if (!content || typeof content !== "object") return content;
  const node = content as JsonNode;
  const out: JsonNode = { ...node };

  if (node.type === "wikiLink") {
    const pageId = node.attrs?.pageId;
    const titel = typeof pageId === "string" ? titles.get(pageId) : undefined;
    out.attrs =
      typeof titel === "string"
        ? { ...node.attrs, label: titel, pageId: opts.stripIds ? null : pageId }
        : {
            ...node.attrs,
            label: opts.ohneTitel ?? LABEL_OHNE_ZUGRIFF,
            pageId: null,
          };
    return out;
  }
  if (node.type === "mention" && opts.stripIds) {
    out.attrs = { ...node.attrs, userId: null };
  }
  if (Array.isArray(node.content)) {
    out.content = node.content.map((c) => resolveLinkLabels(c, titles, opts));
  }
  return out;
}
