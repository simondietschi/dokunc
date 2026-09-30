/**
 * Ungesendete Aenderungen im Tab, clientseitig und ohne React.
 *
 * Beim Abmelden werden alle lokalen Kopien geloescht; was der Server noch
 * nicht bestaetigt hat, ginge dabei verloren. Editoren melden sich hier
 * an (reportUnsentChanges), das Abmelde-Formular fragt (hasUnsentChanges)
 * und warnt dann. Das kennt nur Editoren in diesem Tab; andere Tabs
 * verlieren ihre ungesendeten Aenderungen ohne Rueckfrage, und ein
 * Sitzungsende durch Untaetigkeit kann nicht warnen.
 */

const quellen = new Set<() => boolean>();

/** Meldet eine Quelle an; gibt die Abmeldung zurueck. */
export function reportUnsentChanges(quelle: () => boolean): () => void {
  quellen.add(quelle);
  return () => {
    quellen.delete(quelle);
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
