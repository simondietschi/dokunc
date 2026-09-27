import { describe, expect, it } from "vitest";
import {
  KEEP_ALL_MS,
  hourlyStageFrom,
  versionsToDelete,
  type ThinnableVersion,
} from "./version-thinning";

/**
 * Die Regel des Ausduennens als reine Funktion. Dass die SQL in
 * thinVersions dieselbe Regel umsetzt, prueft
 * test/integration/retention.test.ts.
 *
 * NOW liegt bewusst nicht auf einer vollen Stunde: die Grenze der
 * Stundenstufe (now - 30 Tage) wird auf den Beginn der UTC-Stunde
 * abgerundet, und nur so zeigt sich, ob das geschieht.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date("2026-03-15T14:30:00Z");

function v(id: string, iso: string | number, pinned = false): ThinnableVersion {
  return {
    id,
    createdAt: typeof iso === "number" ? new Date(iso) : new Date(iso),
    pinned,
  };
}

function kept(versions: ThinnableVersion[], now = NOW): string[] {
  const doomed = versionsToDelete(versions, now);
  return versions
    .filter((x) => !doomed.has(x.id))
    .map((x) => x.id)
    .sort();
}

describe("versionsToDelete", () => {
  it("behaelt alles aus den letzten 24 Stunden, auch 30 Versionen in einer Minute", () => {
    const grenze = NOW.getTime() - KEEP_ALL_MS;
    const versions = [
      v("erste", NOW.getTime() - 5 * DAY),
      // genau auf der Grenze: gilt noch als jung, obwohl eine juengere
      // Version dieselbe Stunde gewinnt
      v("grenze", grenze),
      v("danach", grenze + 10 * MIN),
      ...Array.from({ length: 30 }, (_, i) =>
        v(`m${String(i).padStart(2, "0")}`, NOW.getTime() - 2 * HOUR + i * 1000),
      ),
      v("zukunft", NOW.getTime() + DAY),
    ];
    expect(versionsToDelete(versions, NOW).size).toBe(0);
  });

  it("behaelt zwischen 24 Stunden und 30 Tagen die letzte je UTC-Stunde und die erste Version", () => {
    const versions = [
      v("erste", "2026-03-10T10:01:00Z"),
      v("a", "2026-03-10T10:05:00Z"),
      v("b", "2026-03-10T10:20:00Z"),
      v("c", "2026-03-10T10:50:00Z"),
      v("d", "2026-03-10T11:00:00Z"),
      v("e", "2026-03-10T11:59:59Z"),
    ];
    expect(kept(versions)).toEqual(["c", "e", "erste"]);
  });

  it("behaelt nach 30 Tagen die letzte je UTC-Tag", () => {
    const versions = [
      v("erste", "2026-01-20T08:00:00Z"),
      v("a", "2026-02-01T01:00:00Z"),
      v("b", "2026-02-01T13:00:00Z"),
      v("c", "2026-02-01T23:30:00Z"),
      v("d", "2026-02-02T00:10:00Z"),
    ];
    expect(kept(versions)).toEqual(["c", "d", "erste"]);
  });

  it("behaelt gepinnte Versionen mitten im Fach", () => {
    const versions = [
      v("erste", "2026-01-20T08:00:00Z"),
      v("a", "2026-02-01T01:00:00Z"),
      v("quelle", "2026-02-01T05:00:00Z", true),
      v("b", "2026-02-01T09:00:00Z"),
      v("c", "2026-02-01T23:30:00Z"),
    ];
    expect(kept(versions)).toEqual(["c", "erste", "quelle"]);
  });

  it("nimmt bei gleicher Zeit die groessere id, egal in welcher Reihenfolge", () => {
    const t = "2026-03-10T10:30:00Z";
    const gleich = [v("x1", t), v("x2", t), v("x3", t)];
    for (const reihe of [gleich, [...gleich].reverse()]) {
      expect(kept([v("erste", "2026-01-01T00:00:00Z"), ...reihe])).toEqual([
        "erste",
        "x3",
      ]);
    }
    // Die erste Version: bei gleicher Zeit die kleinere id.
    const alt = "2026-01-01T00:00:00Z";
    const gleichAlt = [v("a", alt), v("b", alt), v("c", alt)];
    for (const reihe of [gleichAlt, [...gleichAlt].reverse()]) {
      expect(kept(reihe)).toEqual(["a", "c"]);
    }
  });

  it("trennt am Tag der 30-Tage-Grenze den Tagesteil von den Stundenfaechern, Grenze auf der vollen Stunde", () => {
    // now - 30 Tage = 13.02. 14:30, abgerundet auf 14:00.
    expect(hourlyStageFrom(NOW).toISOString()).toBe("2026-02-13T14:00:00.000Z");
    const versions = [
      v("erste", "2026-01-01T00:00:00Z"),
      // Tagesteil (vor 14:00): die letzte bleibt
      v("t1", "2026-02-13T03:00:00Z"),
      v("t2", "2026-02-13T08:00:00Z"),
      // Stunde 14 ganz in der Stundenstufe, auch vor 14:30
      v("s1", "2026-02-13T14:10:00Z"),
      v("s2", "2026-02-13T14:20:00Z"),
      v("s3", "2026-02-13T14:45:00Z"),
      // Stunde 18
      v("s4", "2026-02-13T18:00:00Z"),
    ];
    expect(kept(versions)).toEqual(["erste", "s3", "s4", "t2"]);
  });
});

/** Kleiner, fester Zufallsgenerator (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dataset(rand: () => number, n: number): ThinnableVersion[] {
  const out: ThinnableVersion[] = [];
  const span = 90 * DAY;
  const hourlyFrom = NOW.getTime() - 30 * DAY;
  const keepAllFrom = NOW.getTime() - KEEP_ALL_MS;
  let last = NOW.getTime() - span;
  for (let i = 0; i < n; i++) {
    let t: number;
    const r = rand();
    if (r < 0.1 && out.length > 0) {
      // Gleiche Zeit wie eine fruehere Version
      t = out[Math.floor(rand() * out.length)].createdAt.getTime();
    } else if (r < 0.2) {
      // Rund um die 30-Tage-Grenze
      t = hourlyFrom + Math.floor((rand() - 0.5) * 60 * MIN);
    } else if (r < 0.25) {
      // Rund um die 24-Stunden-Grenze
      t = keepAllFrom + Math.floor((rand() - 0.5) * 2 * HOUR);
    } else {
      t = last + Math.floor(rand() * (span / Math.max(n, 1)) * 2);
      last = t;
    }
    out.push({
      id: `v${String(i).padStart(4, "0")}${Math.floor(rand() * 1000)}`,
      createdAt: new Date(Math.min(t, NOW.getTime() + HOUR)),
      pinned: rand() < 0.05,
    });
  }
  return out;
}

/**
 * Fach einer Zeit ueber ISO-Text statt ueber Rechnung mit Millisekunden:
 * die Stundenstufe beginnt mit der UTC-Stunde, in der now - 30 Tage liegt.
 */
function fach(t: number, now: Date): string {
  const grenze = new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 13);
  const d = new Date(t);
  if (d.toISOString().slice(0, 13) >= grenze) {
    return `stunde ${d.toISOString().slice(0, 13)}`;
  }
  return `tag ${d.toISOString().slice(0, 10)}`;
}

function newestOf(versions: ThinnableVersion[]): ThinnableVersion {
  return versions.reduce((a, b) =>
    b.createdAt.getTime() > a.createdAt.getTime() ||
    (b.createdAt.getTime() === a.createdAt.getTime() && b.id > a.id)
      ? b
      : a,
  );
}

function oldestOf(versions: ThinnableVersion[]): ThinnableVersion {
  return versions.reduce((a, b) =>
    b.createdAt.getTime() < a.createdAt.getTime() ||
    (b.createdAt.getTime() === a.createdAt.getTime() && b.id < a.id)
      ? b
      : a,
  );
}

describe("versionsToDelete, Eigenschaften", () => {
  it("ist idempotent, nacheinander gleich wie einmal, und loescht nie Junges, Gepinntes, Erstes oder Letztes je Fach", () => {
    const rand = mulberry32(0x5eed12);
    for (let fall = 0; fall < 200; fall++) {
      const n = 1 + Math.floor(rand() * 400);
      const versions = dataset(rand, n);
      const t2 = NOW;
      const t1 = new Date(NOW.getTime() - Math.floor(rand() * 20 * DAY));

      const doomed = versionsToDelete(versions, t2);
      const rest = versions.filter((x) => !doomed.has(x.id));
      // idempotent
      expect(versionsToDelete(rest, t2).size, `Fall ${fall}`).toBe(0);

      // erst bei t1, dann bei t2 = einmal bei t2
      const nachT1 = versions.filter(
        (x) => !versionsToDelete(versions, t1).has(x.id),
      );
      const nachT2 = nachT1.filter(
        (x) => !versionsToDelete(nachT1, t2).has(x.id),
      );
      expect(nachT2.map((x) => x.id).sort(), `Fall ${fall}`).toEqual(
        rest.map((x) => x.id).sort(),
      );

      // nie geloescht: jung, gepinnt, erste, neueste
      const keepAllFrom = t2.getTime() - KEEP_ALL_MS;
      for (const x of versions) {
        if (x.createdAt.getTime() >= keepAllFrom || x.pinned) {
          expect(doomed.has(x.id), `Fall ${fall} ${x.id}`).toBe(false);
        }
      }
      expect(doomed.has(oldestOf(versions).id)).toBe(false);
      expect(doomed.has(newestOf(versions).id)).toBe(false);

      // Je Fach (Stufe und Beginn) bleibt die letzte Version.
      const faecher = new Map<string, ThinnableVersion[]>();
      for (const x of versions) {
        const k = fach(x.createdAt.getTime(), t2);
        faecher.set(k, [...(faecher.get(k) ?? []), x]);
      }
      for (const [k, inFach] of faecher) {
        expect(doomed.has(newestOf(inFach).id), `Fall ${fall} ${k}`).toBe(false);
      }
    }
  });
});
