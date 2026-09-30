import { istSeitenId } from "./link-labels";

/**
 * Titel der Wiki-Link-Ziele im Editor.
 *
 * Die Anzeige eines Wiki-Links liest nie den gespeicherten Titel
 * (Hintergrund in lib/link-labels), sondern fragt hier: vorbelegt vom
 * Server beim Laden der Seite, ergänzt beim Einfügen eines Links aus dem
 * Vorschlag und bei einer Umbenennung, und für alle übrigen Ziele über
 * `GET /api/pages/titles`, in Stapeln gesammelt. Der Server nennt einen
 * Titel nur für Seiten, die die Person öffnen darf.
 *
 * Rein und ohne React: die Anbindung steht in
 * components/editor/WikiLinkTitles.tsx.
 */

export type TitelStand =
  | { status: "laedt" }
  | { status: "sichtbar"; title: string }
  | { status: "gesperrt" }
  | { status: "fehler" };

/** Holt Titel zu IDs; null = kein Zugriff, gelöscht oder unbekannt. */
export type TitleFetcher = (
  ids: string[],
) => Promise<Record<string, string | null>>;

export type TitleStore = {
  /**
   * Stand für eine ID, ohne Nebenwirkung (für useSyncExternalStore).
   * Unveränderte Stände kommen als dasselbe Objekt zurück.
   */
  get(pageId: string | null | undefined): TitelStand;
  /** Titel anfordern, falls noch unbekannt; gesammelt und gestapelt. */
  request(pageId: string): void;
  /** Titel, den die Person gerade selbst gesehen hat (Vorschlag, Umbenennung). */
  seed(pageId: string, title: string): void;
  /** Vorbelegung vom Server: Titel oder null für gesperrt. */
  prime(titles: Readonly<Record<string, string | null>>): void;
  subscribe(listener: () => void): () => void;
};

const LAEDT: TitelStand = Object.freeze({ status: "laedt" });
const GESPERRT: TitelStand = Object.freeze({ status: "gesperrt" });
const FEHLER: TitelStand = Object.freeze({ status: "fehler" });

function ausAntwort(v: string | null | undefined): TitelStand {
  return typeof v === "string" ? Object.freeze({ status: "sichtbar", title: v }) : GESPERRT;
}

export function createTitleStore(
  fetchTitles: TitleFetcher,
  opts: { delayMs?: number; maxBatch?: number } = {},
): TitleStore {
  const delayMs = opts.delayMs ?? 25;
  const maxBatch = opts.maxBatch ?? 100;
  const staende = new Map<string, TitelStand>();
  const wartend = new Set<string>();
  const unterwegs = new Set<string>();
  const hoerer = new Set<() => void>();
  let zeitgeber: ReturnType<typeof setTimeout> | null = null;

  function melde() {
    for (const h of [...hoerer]) h();
  }

  function setze(id: string, stand: TitelStand) {
    staende.set(id, stand);
  }

  async function hole(stapel: string[]) {
    for (const id of stapel) unterwegs.add(id);
    let antwort: Record<string, string | null> | null;
    try {
      antwort = await fetchTitles(stapel);
    } catch {
      antwort = null;
    }
    for (const id of stapel) {
      unterwegs.delete(id);
      // Scheitert der Abruf, bleibt ein Titel stehen, den die Person
      // inzwischen selbst gesehen hat (seed).
      if (staende.get(id)?.status === "sichtbar" && !antwort) continue;
      setze(id, antwort ? ausAntwort(antwort[id]) : FEHLER);
    }
    melde();
  }

  function leere() {
    zeitgeber = null;
    const ids = [...wartend];
    wartend.clear();
    for (let i = 0; i < ids.length; i += maxBatch) {
      void hole(ids.slice(i, i + maxBatch));
    }
  }

  return {
    get(pageId) {
      if (!istSeitenId(pageId)) return GESPERRT;
      return staende.get(pageId) ?? LAEDT;
    },
    request(pageId) {
      if (!istSeitenId(pageId)) return;
      const stand = staende.get(pageId);
      if (stand && stand.status !== "fehler") return;
      if (wartend.has(pageId) || unterwegs.has(pageId)) return;
      wartend.add(pageId);
      zeitgeber ??= setTimeout(leere, delayMs);
    },
    seed(pageId, title) {
      if (!istSeitenId(pageId)) return;
      wartend.delete(pageId);
      setze(pageId, ausAntwort(title));
      melde();
    },
    prime(titles) {
      for (const [id, title] of Object.entries(titles)) {
        if (istSeitenId(id)) setze(id, ausAntwort(title));
      }
      melde();
    },
    subscribe(listener) {
      hoerer.add(listener);
      return () => {
        hoerer.delete(listener);
      };
    },
  };
}

/** Titel über die Route der App; wirft bei jeder Antwort ausser 200. */
export const fetchTitlesFromApi: TitleFetcher = async (ids) => {
  const res = await fetch(
    `/api/pages/titles?ids=${ids.map(encodeURIComponent).join(",")}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Titel nicht geladen (${res.status})`);
  const body = (await res.json()) as { titles?: Record<string, string | null> };
  return body.titles ?? {};
};
