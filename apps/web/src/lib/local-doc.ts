/**
 * Namen und Register der lokalen Dokumentkopien im Browser (y-indexeddb),
 * ohne React und ohne "server-only", damit testbar.
 *
 * Eine Kopie gehoert genau einem Konto. Der Name traegt die Konto-ID, die
 * Restore-Epoche, die Seite und die Version des Editor-Schemas:
 *
 *     dokunc:v2:<userId>:<epoche oder ->:<pageId>:<schemaVersion>
 *
 * - Konto: die naechste Person im selben Browser oeffnet nie die Kopie
 *   der vorigen und schickt nie deren ungesendete Aenderungen unter ihrem
 *   Konto. Kopien eines anderen Kontos werden geloescht, sobald der Server
 *   das eigene Konto bestaetigt hat (removeForeignLocalDocs).
 * - Epoche: eine Kopie aus der Zeit vor einem Restore (scripts/restore.sh
 *   vergibt eine neue Epoche) wird nie geladen und bringt ihre spaeteren
 *   Yjs-Updates nicht in den zurueckgespielten Stand zurueck.
 * - Schemaversion (editorSchema().version): eine Kopie aus einer
 *   neueren Fassung des Editors bleibt unberuehrt (nach einem Rueckweg
 *   kennte dieser Editor ihre Inhalte nicht); eine aus einer aelteren
 *   wird vor dem Verbinden uebernommen und dann geloescht
 *   (lib/local-copy, adoptOlderLocalDocs).
 *
 * Kopien frueherer Versionen hiessen `dokunc:<pageId>` bzw.
 * `dokunc:<epoche>:<pageId>`, ohne Konto. Sie gelten als fremd und werden
 * geloescht, nie uebernommen: sonst bekaeme sie die erste Person, die die
 * Seite oeffnet.
 *
 * Das Praefix "dokunc" bleibt auch bei einer Umbenennung des Produkts:
 * sonst wuerden alle Kopien zu Waisen, die niemand mehr aufraeumt.
 */

/** Praefix aller lokalen Dokumentkopien (y-indexeddb) von dokunc. */
export const LOCAL_DOC_PREFIX = "dokunc";

/** Kennung des Namensformats mit Konto. */
const FORMAT_KONTO = "v2";

/** Steht im Namen fuer "keine Restore-Epoche" (leere Teile gibt es nicht). */
const OHNE_EPOCHE = "-";

/**
 * Hoechstens so viele Kopien eines Kontos behaelt ein Browser. Keine
 * Umgebungsvariable: ein Schalter fuer lokale Kopien gehoert zur spaeteren
 * Offline-Bearbeitung.
 */
export const LOCAL_DOC_MAX_COUNT = 50;

/** Kopien, die so lange nicht geoeffnet wurden, werden geloescht. */
export const LOCAL_DOC_MAX_AGE_MS = 30 * 24 * 3600_000;

/**
 * Kopien, die in dieser Zeit genutzt wurden, kuerzt pruneLocalDocs nie:
 * ein anderer Tab kann sie gerade offen haben. Der Editor fuehrt den
 * Eintrag bei jedem Abgleich und alle fuenf Minuten nach
 * (LOCAL_DOC_TOUCH_INTERVAL_MS), ein offener Tab faellt also nie heraus.
 */
export const LOCAL_DOC_RECENT_MS = 6 * 3600_000;

/** So oft fuehrt ein offener Editor den Registereintrag seiner Kopie nach. */
export const LOCAL_DOC_TOUCH_INTERVAL_MS = 5 * 60_000;

/**
 * Praefix der Registereintraege in localStorage: je Kopie ein eigener
 * Schluessel mit dem Zeitpunkt der letzten Nutzung (ms). Ein gemeinsames
 * JSON-Objekt verloere Eintraege, wenn zwei Tabs es gleichzeitig lesen
 * und zurueckschreiben. y-indexeddb selbst kennt keine Zeitstempel.
 */
export const LOCAL_DOC_REGISTRY_PREFIX = "dokunc:lokale-kopie:";

/** Wem eine Kopie gehoert: Konto und Restore-Epoche. */
export type LocalDocOwner = { userId: string; epoch: string | null };

/** Konto, Epoche und Schemaversion dieses Editors. */
export type LocalDocContext = LocalDocOwner & { schemaVersion: number };

/** Alles, was den Namen einer Kopie bestimmt. */
export type LocalDocRef = LocalDocContext & { pageId: string };

/** Name der lokalen Kopie dieser Seite fuer dieses Konto. */
export function localDocName(ref: LocalDocRef): string {
  return [
    LOCAL_DOC_PREFIX,
    FORMAT_KONTO,
    ref.userId,
    ref.epoch ?? OHNE_EPOCHE,
    ref.pageId,
    String(ref.schemaVersion),
  ].join(":");
}

/** Zerlegter Name: mit Konto oder aus einer frueheren Version (ohne). */
export type ParsedLocalDocName =
  | {
      format: "konto";
      userId: string;
      epoch: string | null;
      pageId: string;
      schemaVersion: number;
    }
  | { format: "alt"; epoch: string | null; pageId: string };

/**
 * Zerlegt einen Namen; null, wenn er nicht von uns stammt oder eine
 * unbekannte Form hat (etwa aus einer spaeteren Version). Solche Namen
 * fasst nur removeAllLocalDocs an.
 */
export function parseLocalDocName(name: string): ParsedLocalDocName | null {
  const teile = name.split(":");
  if (teile[0] !== LOCAL_DOC_PREFIX) return null;
  if (teile.some((t) => t === "")) return null;
  if (teile.length === 6 && teile[1] === FORMAT_KONTO && /^\d+$/.test(teile[5])) {
    return {
      format: "konto",
      userId: teile[2],
      epoch: teile[3] === OHNE_EPOCHE ? null : teile[3],
      pageId: teile[4],
      schemaVersion: Number(teile[5]),
    };
  }
  if (teile.length === 2) return { format: "alt", epoch: null, pageId: teile[1] };
  if (teile.length === 3 && teile[1] !== FORMAT_KONTO) {
    return { format: "alt", epoch: teile[1], pageId: teile[2] };
  }
  return null;
}

/**
 * Gehoert die Kopie nicht zu diesem Konto und dieser Epoche? Namen
 * frueherer Versionen (ohne Konto) sind immer fremd. Namen, die nicht von
 * uns stammen oder eine unbekannte Form haben, nie.
 */
export function isForeignLocalDoc(name: string, owner: LocalDocOwner): boolean {
  const p = parseLocalDocName(name);
  if (!p) return false;
  if (p.format === "alt") return true;
  return p.userId !== owner.userId || p.epoch !== owner.epoch;
}

/**
 * Wie verhaelt sich eine Kopie zu diesem Editor?
 * - fremd: anderes Konto, andere Epoche oder frueheres Namensformat
 *   (loeschen, jede Schemaversion);
 * - aelter: eigene Kopie aus einer aelteren Fassung des Editors
 *   (uebernehmen, dann loeschen);
 * - gleich: eigene Kopie dieser Fassung (oeffnen);
 * - neuer: eigene Kopie einer neueren Fassung (weder oeffnen noch loeschen
 *   noch beim Kuerzen zaehlen);
 * - null: nicht von uns oder unbekannte Form (nicht anfassen).
 */
export function classifyLocalDoc(
  name: string,
  ctx: LocalDocContext,
): "fremd" | "aelter" | "gleich" | "neuer" | null {
  const p = parseLocalDocName(name);
  if (!p) return null;
  if (p.format !== "konto" || isForeignLocalDoc(name, ctx)) return "fremd";
  if (p.schemaVersion < ctx.schemaVersion) return "aelter";
  return p.schemaVersion === ctx.schemaVersion ? "gleich" : "neuer";
}

/** Gehoert der Name zu uns, in welcher Form auch immer? */
function istUnserName(name: string): boolean {
  return name.startsWith(`${LOCAL_DOC_PREFIX}:`);
}

/** Die Teile von localStorage, die das Register braucht. */
export type RegistryLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Die Teile von window.indexedDB, die das Aufraeumen braucht. */
export type IdbFactoryLike = {
  databases?: () => Promise<Array<{ name?: string }>>;
  deleteDatabase(name: string): unknown;
};

/**
 * localStorage des Browsers, oder undefined. Schon der Zugriff kann
 * werfen (gesperrter Speicher, manche privaten Fenster).
 */
function standardRegister(): RegistryLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** window.indexedDB, oder undefined (Server, sehr alte Browser). */
function standardFactory(): IdbFactoryLike | undefined {
  try {
    return typeof indexedDB === "undefined" ? undefined : indexedDB;
  } catch {
    return undefined;
  }
}

/** Traegt die letzte Nutzung einer Kopie ein. Wirft nie. */
export function touchLocalDoc(
  name: string,
  now = Date.now(),
  store: RegistryLike | null | undefined = standardRegister(),
): void {
  try {
    store?.setItem(`${LOCAL_DOC_REGISTRY_PREFIX}${name}`, String(now));
  } catch {
    /* ohne Register wird nur nicht gekuerzt */
  }
}

/** Streicht eine Kopie aus dem Register. Wirft nie. */
export function forgetLocalDoc(
  name: string,
  store: RegistryLike | null | undefined = standardRegister(),
): void {
  try {
    store?.removeItem(`${LOCAL_DOC_REGISTRY_PREFIX}${name}`);
  } catch {
    /* nichts zu tun */
  }
}

/** Alle Registereintraege: Name der Kopie -> letzte Nutzung (ms). */
export function readLocalDocRegistry(
  store: RegistryLike | null | undefined = standardRegister(),
): Map<string, number> {
  const eintraege = new Map<string, number>();
  if (!store) return eintraege;
  try {
    const schluessel: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(LOCAL_DOC_REGISTRY_PREFIX)) schluessel.push(k);
    }
    for (const k of schluessel) {
      const wert = Number(store.getItem(k));
      eintraege.set(
        k.slice(LOCAL_DOC_REGISTRY_PREFIX.length),
        Number.isFinite(wert) ? wert : 0,
      );
    }
  } catch {
    /* gesperrter Speicher: leeres Register */
  }
  return eintraege;
}

/**
 * Namen aller lokalen Kopien von dokunc: was `indexedDB.databases()`
 * kennt, vereinigt mit dem Register. Das Register allein traegt dort, wo
 * `databases()` fehlt oder scheitert. Lehnt nie ab.
 */
export async function listLocalDocs(
  factory: IdbFactoryLike | null | undefined = standardFactory(),
  store: RegistryLike | null | undefined = standardRegister(),
): Promise<string[]> {
  const namen = new Set<string>(readLocalDocRegistry(store).keys());
  if (factory && typeof factory.databases === "function") {
    try {
      for (const d of await factory.databases()) {
        if (typeof d.name === "string") namen.add(d.name);
      }
    } catch {
      /* dann nur das Register */
    }
  }
  return [...namen].filter(istUnserName);
}

/**
 * Loescht eine Kopie und ihren Registereintrag. Ein anderer Tab, der sie
 * offen hat, schliesst sie bei `versionchange` und koppelt seine
 * Persistenz ab (lib/local-copy, guardLocalCopy); die Loeschung wartet
 * nicht auf ihn.
 */
function loesche(
  name: string,
  factory: IdbFactoryLike | null | undefined,
  store: RegistryLike | null | undefined,
): void {
  try {
    factory?.deleteDatabase(name);
  } catch {
    /* best effort */
  }
  forgetLocalDoc(name, store);
}

/**
 * Loescht alle Kopien, die nicht zu diesem Konto und dieser Epoche
 * gehoeren (in jeder Schemaversion), dazu alle Kopien frueherer Versionen.
 * Erst aufrufen, wenn der Server Konto und Epoche bestaetigt hat (Ticket):
 * ein Tab mit veralteten Angaben loeschte sonst die richtigen Kopien.
 * Gibt die Namen zurueck, lehnt nie ab.
 */
export async function removeForeignLocalDocs(
  owner: LocalDocOwner,
  factory: IdbFactoryLike | null | undefined = standardFactory(),
  store: RegistryLike | null | undefined = standardRegister(),
): Promise<string[]> {
  try {
    const fremde = (await listLocalDocs(factory, store)).filter((n) =>
      isForeignLocalDoc(n, owner),
    );
    for (const name of fremde) loesche(name, factory, store);
    return fremde;
  } catch {
    return [];
  }
}

/**
 * Setzt Anzahl- und Altersgrenze durch. Gezaehlt werden die
 * Registereintraege dieses Kontos und dieser Epoche mit gleicher oder
 * aelterer Schemaversion. Geloescht wird, was aelter als `maxAgeMs` ist
 * oder jenseits der `maxCount` zuletzt genutzten liegt, ausser `keep`
 * (die gerade geoeffnete Kopie) und Kopien, die in den letzten
 * `recentMs` genutzt wurden (ein anderer Tab kann sie offen haben).
 * Kopien ohne Registereintrag bleiben stehen; das kommt nur vor, wenn
 * localStorage nicht verfuegbar war. Gibt die Namen zurueck, wirft nie.
 */
export function pruneLocalDocs(
  ctx: LocalDocContext,
  o: {
    keep: string;
    now?: number;
    maxCount?: number;
    maxAgeMs?: number;
    recentMs?: number;
  },
  factory: IdbFactoryLike | null | undefined = standardFactory(),
  store: RegistryLike | null | undefined = standardRegister(),
): string[] {
  const now = o.now ?? Date.now();
  const maxCount = o.maxCount ?? LOCAL_DOC_MAX_COUNT;
  const maxAgeMs = o.maxAgeMs ?? LOCAL_DOC_MAX_AGE_MS;
  const recentMs = o.recentMs ?? LOCAL_DOC_RECENT_MS;
  const eigene = [...readLocalDocRegistry(store)]
    .filter(([name]) => {
      const art = classifyLocalDoc(name, ctx);
      return art === "gleich" || art === "aelter";
    })
    .sort((a, b) => b[1] - a[1]);
  const weg = eigene
    .filter(
      ([name, zuletzt], i) =>
        name !== o.keep &&
        now - zuletzt >= recentMs &&
        (now - zuletzt > maxAgeMs || i >= maxCount),
    )
    .map(([name]) => name);
  for (const name of weg) loesche(name, factory, store);
  return weg;
}

/**
 * Loescht jede lokale Kopie von dokunc in diesem Browser, in jeder Form
 * und fuer jedes Konto, dazu das ganze Register. Ohne gueltige Sitzung
 * gibt es keine lokalen Kopien. Gibt die Namen zurueck, lehnt nie ab.
 */
export async function removeAllLocalDocs(
  factory: IdbFactoryLike | null | undefined = standardFactory(),
  store: RegistryLike | null | undefined = standardRegister(),
): Promise<string[]> {
  try {
    const alle = await listLocalDocs(factory, store);
    for (const name of alle) loesche(name, factory, store);
    return alle;
  } catch {
    return [];
  }
}
