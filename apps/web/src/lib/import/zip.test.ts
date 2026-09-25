import { describe, it, expect } from "vitest";
import { Zip, ZipDeflate, ZipPassThrough, zipSync, unzipSync, strToU8 } from "fflate";
import { extractZip, newZipBudget, ZIP_MAX_ENTRIES, ZIP_MAX_FILE } from "./zip";
import { normalizePath } from "./paths";
import { ImportError } from "./types";

/* ------------------------------------------------------------------ */
/* Werkzeuge, um Zips gezielt zu verbiegen                             */
/* ------------------------------------------------------------------ */

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Offset des Endeintrags (ohne Kommentar: die letzten 22 Bytes). */
function eocdOf(zip: Uint8Array): number {
  const at = zip.length - 22;
  expect(view(zip).getUint32(at, true)).toBe(0x06054b50);
  return at;
}

/** Offsets aller Eintraege im zentralen Verzeichnis, nach Namen. */
function centralEntries(zip: Uint8Array): Map<string, number> {
  const v = view(zip);
  const eocd = eocdOf(zip);
  const count = v.getUint16(eocd + 10, true);
  let at = v.getUint32(eocd + 16, true);
  const out = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    out.set(name, at);
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}

/** Deklarierte (entpackte) Groesse eines Eintrags im Verzeichnis ueberschreiben. */
function declare(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice();
  view(out).setUint32(centralEntries(out).get(name)! + 24, size, true);
  return out;
}

/** Wie es vorher war: unzipSync entpackt alles auf einmal. */
function oldExtract(zip: Uint8Array): Map<string, Uint8Array> {
  const raw = unzipSync(zip, {
    filter: (f) =>
      !f.name.endsWith("/") && !f.name.startsWith("__MACOSX/") && !f.name.endsWith(".DS_Store"),
  });
  const out = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(raw)) {
    const path = normalizePath(name);
    if (path) out.set(path, bytes);
  }
  return out;
}

/**
 * Zip wie von streamenden Packern (Browser, manche Export-Werkzeuge):
 * Groessen erst im Datendeskriptor HINTER den Daten, im lokalen Kopf 0.
 * Gelesen werden duerfen sie nur aus dem zentralen Verzeichnis.
 */
function streamedZip(entries: Record<string, Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    chunks.push(chunk);
  });
  let i = 0;
  for (const [name, data] of Object.entries(entries)) {
    // Abwechselnd komprimiert und gespeichert.
    const file = i++ % 2 === 0 ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    zip.add(file);
    file.push(data, true);
  }
  zip.end();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function pseudoRandom(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe("extractZip()", () => {
  it("normalisiert Pfade und ignoriert OS-Metadaten", () => {
    const zip = zipSync({
      "Handbuch/index.md": strToU8("# Handbuch"),
      "Handbuch/Kapitel 1.md": strToU8("# Kapitel 1"),
      "__MACOSX/Handbuch/._index.md": strToU8("junk"),
      "Handbuch/.DS_Store": strToU8("junk"),
      "Handbuch/": new Uint8Array(0),
    });
    const { files, rejected } = extractZip(zip);
    expect(rejected).toEqual([]);
    expect(files.map((f) => f.path).sort()).toEqual([
      "Handbuch/Kapitel 1.md",
      "Handbuch/index.md",
    ]);
    const index = files.find((f) => f.path === "Handbuch/index.md")!;
    expect(new TextDecoder().decode(index.read())).toBe("# Handbuch");
  });

  it("lehnt Path-Traversal und absolute Pfade ab", () => {
    const zip = zipSync({
      "../evil.md": strToU8("x"),
      "/abs.md": strToU8("x"),
      "ok/../../evil2.md": strToU8("x"),
      "gut.md": strToU8("x"),
    });
    const { files, rejected } = extractZip(zip);
    expect(files.map((f) => f.path)).toEqual(["gut.md"]);
    expect(rejected.sort()).toEqual(["../evil.md", "/abs.md", "ok/../../evil2.md"].sort());
  });

  it("wirft bei zu vielen Eintraegen", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i++) entries[`f${i}.md`] = strToU8("x");
    expect(() => extractZip(zipSync(entries))).toThrow(ImportError);
  });

  it("ueberspringt einzelne Eintraege ueber dem Groessenlimit", () => {
    const zip = zipSync(
      {
        "klein.md": strToU8("# ok"),
        "riesig.md": new Uint8Array(ZIP_MAX_FILE + 1),
      },
      { level: 9 },
    );
    const { files, tooLarge } = extractZip(zip);
    expect(files.map((f) => f.path)).toEqual(["klein.md"]);
    expect(tooLarge).toEqual(["riesig.md"]);
  });

  it("wirft bei kaputten Daten", () => {
    expect(() => extractZip(strToU8("kein zip"))).toThrow(ImportError);
  });
});

describe("extractZip(): einzeln entpacken", () => {
  // Gemischt wie echte Exporte: Ordner, Umlaute (UTF-8-Kennzeichen),
  // gespeicherte und komprimierte Eintraege, Binaerdaten, leere Datei.
  const inhalt: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    "Wiki/index.md": strToU8("# Wiki\n\n[A](A.md)\n"),
    "Wiki/Größen & Maße.md": strToU8("# Umlaute\n".repeat(500)),
    "Wiki/bilder/foto.png": pseudoRandom(300_000, 7),
    "Wiki/roh.html": [strToU8("<h1>gespeichert</h1>"), { level: 0 }],
    "Wiki/leer.md": new Uint8Array(0),
    "Wiki/leer-gespeichert.md": [new Uint8Array(0), { level: 0 }],
    "Wiki//doppelt.md": strToU8("# doppelter Schraegstrich"),
    "Wiki/": new Uint8Array(0),
  };

  it("liefert dieselben Dateien wie das Entpacken auf einmal", () => {
    const zip = zipSync(inhalt, { level: 6 });
    const budget = newZipBudget();
    const { files, rejected, tooLarge } = extractZip(zip, budget);
    expect(rejected).toEqual([]);
    expect(tooLarge).toEqual([]);

    const vorher = oldExtract(zip);
    expect(files.map((f) => f.path)).toEqual(
      [...vorher.keys()].sort((a, b) => a.localeCompare(b)),
    );
    let summe = 0;
    for (const f of files) {
      const bytes = f.read();
      expect(bytes, f.path).toEqual(vorher.get(f.path));
      expect(f.size, f.path).toBe(bytes.length);
      summe += bytes.length;
    }
    // Die tatsaechlich entpackten Bytes stehen im Budget.
    expect(budget.inflated).toBe(summe);
  });

  it("entpackt bei jedem read() neu, statt die Daten festzuhalten", () => {
    const zip = zipSync({ "a.md": strToU8("# A") });
    const [file] = extractZip(zip).files;
    const erste = file.read();
    erste.fill(0);
    // Eine Kopie: wer sein Ergebnis veraendert, beschaedigt weder das
    // Zip noch den naechsten Lesevorgang.
    expect(new TextDecoder().decode(file.read())).toBe("# A");
    expect(file.read()).not.toBe(file.read());
  });

  it("liest Zip64 (Zusatzfeld und Zip64-Endeintrag) wie vorher", () => {
    const daten = pseudoRandom(5000, 3);
    const u64 = (n: number) => {
      const b = new Uint8Array(8);
      view(b).setUint32(0, n, true);
      return b;
    };
    // Zusatzfeld 1 mit entpackter und gepackter Groesse (gespeichert:
    // beide gleich); im Verzeichnis stehen danach nur noch 0xFFFFFFFF.
    const extra = new Uint8Array([...u64(daten.length), ...u64(daten.length)]);
    const plain = zipSync({ "gross.bin": [daten, { level: 0, extra: { 1: extra } }] });
    const cd = centralEntries(plain).get("gross.bin")!;
    view(plain).setUint32(cd + 20, 0xffffffff, true);
    view(plain).setUint32(cd + 24, 0xffffffff, true);

    // Zip64-Endeintrag plus Locator vor den klassischen Endeintrag.
    const eocd = eocdOf(plain);
    const cdSize = view(plain).getUint32(eocd + 12, true);
    const cdOffset = view(plain).getUint32(eocd + 16, true);
    const rec = new Uint8Array(56);
    const r = view(rec);
    r.setUint32(0, 0x06064b50, true);
    r.setUint32(4, 44, true);
    r.setUint16(12, 45, true);
    r.setUint32(24, 1, true); // Eintraege auf dieser Platte
    r.setUint32(32, 1, true); // Eintraege gesamt
    r.setUint32(40, cdSize, true);
    r.setUint32(48, cdOffset, true);
    const loc = new Uint8Array(20);
    view(loc).setUint32(0, 0x07064b50, true);
    view(loc).setUint32(8, eocd, true); // Offset des Zip64-Endeintrags
    view(loc).setUint32(16, 1, true);
    const end = plain.slice(eocd);
    view(end).setUint16(8, 0xffff, true);
    view(end).setUint16(10, 0xffff, true);
    view(end).setUint32(16, 0xffffffff, true);
    const zip64 = new Uint8Array([...plain.subarray(0, eocd), ...rec, ...loc, ...end]);

    const { files } = extractZip(zip64);
    expect(files.map((f) => f.path)).toEqual(["gross.bin"]);
    expect(files[0].read()).toEqual(daten);
    expect(files[0].read()).toEqual(unzipSync(zip64)["gross.bin"]);
  });

  it("liest Zips mit Datendeskriptor (Groessen hinter den Daten) wie vorher", () => {
    const zip = streamedZip({
      "Export/index.md": strToU8("# Export\n".repeat(200)),
      "Export/bild.png": pseudoRandom(50_000, 11),
      "Export/Unterseite.md": strToU8("# Unter\n"),
      "Export/leer.md": new Uint8Array(0),
    });
    // Wirklich gestreamt: Bit 3 gesetzt, gepackte Groesse im lokalen Kopf 0.
    expect(view(zip).getUint16(6, true) & 8).toBe(8);
    expect(view(zip).getUint32(18, true)).toBe(0);

    const { files } = extractZip(zip);
    const vorher = oldExtract(zip);
    expect(files.map((f) => f.path)).toEqual(
      [...vorher.keys()].sort((a, b) => a.localeCompare(b)),
    );
    for (const f of files) expect(f.read(), f.path).toEqual(vorher.get(f.path));
  });

  it("liest Namen ohne UTF-8-Kennzeichen als Latin-1 wie vorher", () => {
    const zip = zipSync({ "Größe.md": strToU8("# x"), "plain.md": strToU8("# y") });
    // Kennzeichen im Verzeichnis loeschen: die UTF-8-Bytes des Namens
    // gelten dann als Latin-1 (so schreiben aeltere Windows-Packer).
    const cd = centralEntries(zip).get("Größe.md")!;
    view(zip).setUint16(cd + 8, view(zip).getUint16(cd + 8, true) & ~0x800, true);

    const { files } = extractZip(zip);
    const vorher = oldExtract(zip);
    expect(files.map((f) => f.path).sort()).toEqual([...vorher.keys()].sort());
    expect(files.map((f) => f.path)).toContain("GrÃ¶Ã\u009fe.md");
  });

  it("findet das Verzeichnis auch hinter einem Kommentar am Ende", () => {
    const plain = zipSync({ "a.md": strToU8("# A") });
    const kommentar = strToU8("Erstellt von einem Export-Werkzeug. ".repeat(100));
    const zip = new Uint8Array([...plain, ...kommentar]);
    view(zip).setUint16(plain.length - 22 + 20, kommentar.length, true);

    const { files } = extractZip(zip);
    expect(files.map((f) => f.path)).toEqual(["a.md"]);
    expect(new TextDecoder().decode(files[0].read())).toBe("# A");
  });

  it("lehnt verschluesselte Eintraege mit eigener Meldung ab", () => {
    const zip = zipSync({ "geheim.md": strToU8("# x") });
    const cd = centralEntries(zip).get("geheim.md")!;
    view(zip).setUint16(cd + 8, view(zip).getUint16(cd + 8, true) | 1, true);
    expect(() => extractZip(zip)).toThrow(/Verschlüsselte Zip-Dateien/);
  });
});

describe("extractZip(): Schutz gegen Zip-Bomben", () => {
  it("prueft die tatsaechlich entpackten Bytes, nicht nur die Angabe", () => {
    // 20 MB Nullen, gepackt ein paar KB, im Verzeichnis als 1 KB
    // angegeben. Ohne Pruefung der echten Groesse ginge der Eintrag als
    // klein durch das Budget.
    const zip = declare(
      zipSync({ "bombe.md": new Uint8Array(20 * 1024 * 1024) }, { level: 9 }),
      "bombe.md",
      1024,
    );
    expect(zip.length).toBeLessThan(100_000);
    expect(() => extractZip(zip)).toThrow("Zip-Datei konnte nicht gelesen werden.");
  });

  it("lehnt ab, bevor entpackt wird, wenn die Angaben das Budget sprengen", () => {
    // Echte Daten winzig, Angaben je 30 MB: sieben davon liegen ueber
    // den 200 MB, und das faellt schon beim Lesen des Verzeichnisses auf.
    let zip: Uint8Array = zipSync(
      Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`s${i}.md`, strToU8("# x")])),
    );
    for (let i = 0; i < 7; i++) zip = declare(zip, `s${i}.md`, 30 * 1024 * 1024);
    expect(() => extractZip(zip)).toThrow(/entpackt grösser als 200 MB/);
  });

  it("teilt das Budget ueber alle Zips derselben Anfrage", () => {
    const vier = () => {
      let zip: Uint8Array = zipSync(
        Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`s${i}.md`, strToU8("# x")])),
      );
      for (let i = 0; i < 4; i++) zip = declare(zip, `s${i}.md`, 30 * 1024 * 1024);
      return zip;
    };
    const budget = newZipBudget();
    expect(extractZip(vier(), budget).files).toHaveLength(4);
    // 120 MB angegeben, das zweite Zip braechte 240 MB.
    expect(() => extractZip(vier(), budget)).toThrow(/entpackt grösser als 200 MB/);
  });

  it("zaehlt die Eintraege ueber alle Zips derselben Anfrage", () => {
    const half = (p: string) => {
      const entries: Record<string, Uint8Array> = {};
      for (let i = 0; i < ZIP_MAX_ENTRIES / 2 + 1; i++) entries[`${p}${i}.md`] = strToU8("x");
      return zipSync(entries);
    };
    const budget = newZipBudget();
    extractZip(half("a"), budget);
    expect(() => extractZip(half("b"), budget)).toThrow(ImportError);
  });

  it("prueft auch gespeicherte (nicht komprimierte) Eintraege gegen ihre Angabe", () => {
    // Gespeichert heisst: die Daten sind so gross wie die gepackte
    // Groesse. Steht im Verzeichnis eine kleinere entpackte Groesse,
    // ginge der Eintrag sonst mit der kleinen Angabe durch das Budget.
    const zip = declare(
      zipSync({ "gross.md": [new Uint8Array(3 * 1024 * 1024), { level: 0 }] }),
      "gross.md",
      10,
    );
    expect(() => extractZip(zip)).toThrow("Zip-Datei konnte nicht gelesen werden.");
  });

  it("fuehrt Angabe und tatsaechlich entpackte Bytes getrennt", () => {
    // Angabe groesser als die Daten: das Budget rechnet die Angabe (vor
    // dem Entpacken), die Datei hat ihre echte Groesse. Auf `size` stuetzen
    // sich die Groessenpruefungen in run.ts, die ohne Entpacken auskommen.
    const zip = declare(zipSync({ "klein.md": strToU8("# klein") }), "klein.md", 5_000_000);
    const budget = newZipBudget();
    const { files } = extractZip(zip, budget);
    expect(files[0].size).toBe(7);
    expect(files[0].read()).toEqual(strToU8("# klein"));
    expect(budget.unpacked).toBe(5_000_000);
    expect(budget.inflated).toBe(7);
  });

  it("lehnt einen Eintrag ab, der ueber das Ende der Datei zeigt", () => {
    const zip = zipSync({ "a.md": strToU8("# A".repeat(100)) });
    const cd = centralEntries(zip).get("a.md")!;
    view(zip).setUint32(cd + 20, 50_000_000, true); // gepackte Groesse
    expect(() => extractZip(zip)).toThrow("Zip-Datei konnte nicht gelesen werden.");
  });
});
