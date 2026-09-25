/**
 * Voyage-Client fuer Embeddings, gemeinsam fuer Web-App (Frage) und
 * Collab-Server (KI-Index im Hintergrund, apps/collab/src/ai-indexer.ts).
 *
 * Ohne Logger: wer hier etwas melden will, reicht `warn` herein. Die
 * Meldungen zu HTTP-Status und Netzfehler loggt der Aufrufer anhand von
 * `reason`, weil nur er weiss, ob ein Fehler je Frage oder nur einmal je
 * Ausfall ins Log gehoert.
 */

export const DEFAULT_EMBEDDING_MODEL = "voyage-3.5-lite";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
/**
 * Frist einer Anfrage. Ein haengender Dienst hielte sonst den KI-Index
 * unter seiner Sperre fest und liesse jede Frage bis zum Abbruch der
 * Verbindung warten.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

type Env = Record<string, string | undefined>;
export type EmbedWarn = (detail: object, msg: string) => void;

/**
 * Modell der Embeddings. `||` statt `??`: docker-compose.yml setzt
 * EMBEDDING_MODEL auf den leeren String, und `??` liesse ihn durch. Die
 * Anfrage an Voyage ginge dann mit `model: ""` hinaus, der Fehler landete
 * nur im Log, und die semantische Suche fiele still auf Volltext zurueck.
 */
export function embeddingModel(env: Env = process.env): string {
  return env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

/** VOYAGE_API_KEY, wenn gesetzt und nicht leer, sonst null. */
export function embeddingKey(env: Env = process.env): string | null {
  return env.VOYAGE_API_KEY?.trim() || null;
}

/**
 * Antwort des Embedding-Dienstes in die Reihenfolge der gesendeten Texte
 * bringen.
 *
 * Die Aufrufer ordnen die Vektoren rein ueber die Position dem jeweiligen
 * Chunk zu. Kaeme die Antwort kuerzer zurueck, landete `undefined` in
 * vectorToBytes; kaeme sie umsortiert, stuende das falsche Embedding
 * dauerhaft in PageChunk.embedding und die semantische Suche lieferte
 * stillschweigend falsche Treffer. Deshalb: `index` auswerten, wo der
 * Dienst ihn mitgibt, und bei allem, was nicht genau passt, lieber gar
 * kein Embedding (`null`) als ein falsch zugeordnetes.
 */
export function parseEmbeddings(
  payload: unknown,
  count: number,
  warn?: EmbedWarn,
): number[][] | null {
  const items = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(items) || items.length !== count) {
    warn?.(
      { erwartet: count, erhalten: Array.isArray(items) ? items.length : null },
      "voyage embeddings: unerwartete Antwortlaenge",
    );
    return null;
  }
  const out: number[][] = new Array(count);
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as { index?: unknown; embedding?: unknown } | null;
    // Ohne `index` gilt die Reihenfolge der Anfrage.
    const at = typeof item?.index === "number" ? item.index : i;
    const v = item?.embedding;
    if (
      !Number.isInteger(at) ||
      at < 0 ||
      at >= count ||
      out[at] !== undefined ||
      !Array.isArray(v) ||
      v.length === 0 ||
      v.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      warn?.({ index: at }, "voyage embeddings: unerwarteter Eintrag");
      return null;
    }
    out[at] = v as number[];
  }
  return out;
}

export type EmbedResult =
  | { ok: true; vectors: number[][] }
  | { ok: false; reason: "rate-limit"; status: 429; retryAfterMs: number | null }
  | { ok: false; reason: "http"; status: number }
  | { ok: false; reason: "network"; err: unknown }
  | { ok: false; reason: "invalid" };

/** Retry-After als Sekunden oder HTTP-Datum, sonst null. */
function retryAfterMs(raw: string | null, now: number): number | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Texte bei Voyage AI einbetten.
 *
 * Nie eine Ausnahme: jeder Fehler kommt als `{ ok: false, reason }`
 * zurueck. 429 liefert die Wartezeit aus Retry-After, damit der KI-Index
 * seine Stufe so lange ruhen lassen kann.
 */
export async function requestEmbeddings(
  texts: string[],
  opts: {
    key: string;
    model: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    warn?: EmbedWarn;
  },
): Promise<EmbedResult> {
  if (texts.length === 0) return { ok: true, vectors: [] };
  // Erst beim Aufruf nachschlagen, damit Tests fetch austauschen koennen.
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  let payload: unknown;
  try {
    const res = await doFetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: opts.model, input: texts }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (res.status === 429) {
      return {
        ok: false,
        reason: "rate-limit",
        status: 429,
        retryAfterMs: retryAfterMs(res.headers.get("retry-after"), Date.now()),
      };
    }
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    try {
      payload = await res.json();
    } catch (err) {
      // Kein JSON ist eine kaputte Antwort, kein Netzfehler; ein Abbruch
      // mitten im Lesen (Frist, Verbindung) dagegen schon.
      if (!(err instanceof SyntaxError)) throw err;
      opts.warn?.({ err }, "voyage embeddings: Antwort ist kein JSON");
      return { ok: false, reason: "invalid" };
    }
  } catch (err) {
    return { ok: false, reason: "network", err };
  }
  const vectors = parseEmbeddings(payload, texts.length, opts.warn);
  return vectors ? { ok: true, vectors } : { ok: false, reason: "invalid" };
}
