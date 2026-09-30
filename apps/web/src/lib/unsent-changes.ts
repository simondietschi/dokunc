/**
 * Ungesendete Aenderungen, clientseitig und ohne React.
 *
 * Beim Abmelden werden alle lokalen Kopien geloescht; was der Server noch
 * nicht bestaetigt hat, ginge dabei verloren. Editoren melden sich hier
 * an (reportUnsentChanges), die Abmelde-Formulare fragen
 * (hasUnsentChangesAnywhere) und warnen dann. Gefragt werden die Editoren
 * in diesem Tab und, ueber einen BroadcastChannel, die in anderen Tabs
 * desselben Browsers. Ein Sitzungsende durch Untaetigkeit kann nicht
 * vorher warnen; dort sagt es der betroffene Tab, sobald er es merkt.
 */

const quellen = new Set<() => boolean>();

/** Kanal, ueber den Tabs einander nach ungesendeten Aenderungen fragen. */
export const UNSENT_CHANNEL = "dokunc:ungesendet";

/**
 * So lange wartet eine Rueckfrage hoechstens auf andere Tabs. Die Antwort
 * kommt im selben Browser meist in wenigen Millisekunden; die Frist laesst
 * einem beschaeftigten Tab im Hintergrund Luft. Ohne Antwort hat kein
 * anderer Tab etwas Ungesendetes (oder der Browser hat ihn eingefroren).
 */
export const OTHER_TABS_WAIT_MS = 300;

type Frage = { art: "frage"; id: string };
type Antwort = { art: "antwort"; id: string };

function istFrage(d: unknown): d is Frage {
  if (typeof d !== "object" || d === null) return false;
  const f = d as Partial<Frage>;
  return f.art === "frage" && typeof f.id === "string";
}

function istAntwort(d: unknown, id: string): d is Antwort {
  if (typeof d !== "object" || d === null) return false;
  const a = d as Partial<Antwort>;
  return a.art === "antwort" && a.id === id;
}

function oeffneKanal(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    return new BroadcastChannel(UNSENT_CHANNEL);
  } catch {
    return null;
  }
}

/**
 * Solange in diesem Tab ein Editor angemeldet ist, beantwortet der Tab
 * Rueckfragen anderer Tabs, aber nur mit "ja": ohne Ungesendetes
 * schweigt er.
 */
let antwortKanal: BroadcastChannel | null = null;

function antwortenEin() {
  if (antwortKanal !== null || quellen.size === 0) return;
  const kanal = oeffneKanal();
  if (kanal === null) return;
  kanal.onmessage = (e: MessageEvent) => {
    if (!istFrage(e.data) || !hasUnsentChanges()) return;
    const antwort: Antwort = { art: "antwort", id: e.data.id };
    try {
      kanal.postMessage(antwort);
    } catch {
      /* Kanal schon zu */
    }
  };
  antwortKanal = kanal;
}

function antwortenAus() {
  if (quellen.size > 0 || antwortKanal === null) return;
  antwortKanal.close();
  antwortKanal = null;
}

/** Meldet eine Quelle an; gibt die Abmeldung zurueck. */
export function reportUnsentChanges(quelle: () => boolean): () => void {
  quellen.add(quelle);
  antwortenEin();
  return () => {
    quellen.delete(quelle);
    antwortenAus();
  };
}

/** Hat irgendeine angemeldete Quelle ungesendete Aenderungen? */
export function hasUnsentChanges(): boolean {
  for (const quelle of quellen) {
    try {
      if (quelle()) return true;
    } catch {
      /* eine werfende Quelle zaehlt als nein */
    }
  }
  return false;
}

/**
 * Hat ein anderer Tab dieses Browsers ungesendete Aenderungen? Fragt
 * ueber den BroadcastChannel und wartet hoechstens `waitMs` auf ein "ja".
 * Ohne BroadcastChannel nein. Lehnt nie ab.
 */
export function unsentChangesInOtherTabs(waitMs = OTHER_TABS_WAIT_MS): Promise<boolean> {
  const kanal = oeffneKanal();
  if (kanal === null) return Promise.resolve(false);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return new Promise<boolean>((resolve) => {
    let fertig = false;
    const ende = (ja: boolean) => {
      if (fertig) return;
      fertig = true;
      clearTimeout(frist);
      kanal.close();
      resolve(ja);
    };
    const frist = setTimeout(() => ende(false), waitMs);
    kanal.onmessage = (e: MessageEvent) => {
      if (istAntwort(e.data, id)) ende(true);
    };
    try {
      const frage: Frage = { art: "frage", id };
      kanal.postMessage(frage);
    } catch {
      ende(false);
    }
  });
}

/** Ungesendete Aenderungen in diesem oder einem anderen Tab? */
export async function hasUnsentChangesAnywhere(waitMs = OTHER_TABS_WAIT_MS): Promise<boolean> {
  return hasUnsentChanges() || (await unsentChangesInOtherTabs(waitMs));
}

type UpdateQuelle = {
  on(name: "update", f: (update: Uint8Array, origin: unknown) => void): void;
  off(name: "update", f: (update: Uint8Array, origin: unknown) => void): void;
};

type SyncQuelle = {
  on(name: "unsyncedChanges", f: (d: { number: number }) => void): void;
  off(name: "unsyncedChanges", f: (d: { number: number }) => void): void;
};

/**
 * Zaehlt eigene Eingaben (Updates, deren Herkunft nicht `fremd` ist:
 * nicht vom Server, nicht aus der lokalen Kopie) und setzt den Zaehler
 * zurueck, sobald der Provider nichts Unbestaetigtes mehr meldet.
 *
 * `provider.hasUnsyncedChanges` allein taugt nicht: der Provider setzt
 * seinen Zaehler bei jedem Verbindungsaufbau auf 1, auch ohne eine
 * einzige Eingabe, und er bliebe in einem nicht verbundenen Tab stehen.
 */
export function watchUnsentChanges(
  doc: UpdateQuelle,
  provider: SyncQuelle,
  fremd: (origin: unknown) => boolean,
): { pending(): boolean; stop(): void } {
  let eigene = 0;
  const beiUpdate = (_update: Uint8Array, origin: unknown) => {
    if (!fremd(origin)) eigene += 1;
  };
  const beiStand = ({ number }: { number: number }) => {
    if (number === 0) eigene = 0;
  };
  doc.on("update", beiUpdate);
  provider.on("unsyncedChanges", beiStand);
  return {
    pending: () => eigene > 0,
    stop: () => {
      doc.off("update", beiUpdate);
      provider.off("unsyncedChanges", beiStand);
    },
  };
}
