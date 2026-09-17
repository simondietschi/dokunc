import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  baueAusrichtungsSegment,
  leseAusrichtung,
  stripImageMetadata,
} from "./image-metadata";

/**
 * Die Tests bauen echte Container-Bytes, keine Attrappen: geprueft wird
 * genau das Umschreiben, und ein Mock wuerde die Struktur nachbauen, um
 * die es geht.
 */

function bytes(...teile: (number[] | Uint8Array)[]): Uint8Array {
  const flach: number[] = [];
  for (const t of teile) flach.push(...Array.from(t));
  return new Uint8Array(flach);
}

/** JPEG-Segment: Marker, Laengenfeld, Nutzlast. */
function segment(marker: number, nutz: number[]): number[] {
  const laenge = nutz.length + 2;
  return [0xff, marker, (laenge >> 8) & 0xff, laenge & 0xff, ...nutz];
}

/** TIFF (little endian) mit beliebig vielen SHORT-Eintraegen in IFD0. */
function tiff(eintraege: [tag: number, wert: number][]): number[] {
  const kopf = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00];
  const zahl = [eintraege.length & 0xff, (eintraege.length >> 8) & 0xff];
  const felder = eintraege.flatMap(([tag, wert]) => [
    tag & 0xff,
    (tag >> 8) & 0xff,
    0x03,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    wert & 0xff,
    (wert >> 8) & 0xff,
    0x00,
    0x00,
  ]);
  return [...kopf, ...zahl, ...felder, 0x00, 0x00, 0x00, 0x00];
}

const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
/** Bilddaten ab SOS — muessen Byte fuer Byte erhalten bleiben. */
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const BILDDATEN = [0xaa, 0xbb, 0xff, 0x00, 0xcc, 0xff, 0xd9];

describe("stripImageMetadata() fuer JPEG", () => {
  it("wirft den EXIF-Abschnitt samt GPS-Zeiger heraus", () => {
    // 0x8825 ist der Zeiger auf die GPS-Daten: der verraet den Ort.
    const roh = bytes(
      [0xff, 0xd8],
      segment(0xe1, [...EXIF, ...tiff([[0x8825, 0x1234]])]),
      SOS,
      BILDDATEN,
    );
    const rein = stripImageMetadata(roh, "image/jpeg");
    expect(rein.length).toBeLessThan(roh.length);
    expect(Array.from(rein).join(",")).not.toContain("69,102"); // "if" aus "Exif"
    expect(Array.from(rein.subarray(2))).toEqual([...SOS, ...BILDDATEN]);
  });

  it("rettet die Ausrichtung in einen frischen Abschnitt", () => {
    // Ohne sie laege jedes Hochkant-Foto aus einem Telefon auf der Seite.
    const roh = bytes(
      [0xff, 0xd8],
      segment(0xe1, [
        ...EXIF,
        ...tiff([
          [0x0112, 6],
          [0x8825, 0x1234],
        ]),
      ]),
      SOS,
      BILDDATEN,
    );
    const rein = stripImageMetadata(roh, "image/jpeg");
    const erwartet = baueAusrichtungsSegment(6);
    // Der neue Abschnitt steht direkt hinter SOI und ist der erwartete.
    expect(Array.from(rein.subarray(2, 2 + erwartet.length))).toEqual(
      Array.from(erwartet),
    );
    // Und er traegt genau diesen einen Eintrag: 4 Byte Markerkopf,
    // 6 Byte "Exif\0\0", dahinter der TIFF-Block.
    expect(
      leseAusrichtung(rein.subarray(2 + 4 + 6, 2 + erwartet.length)),
    ).toBe(6);
    // Und der GPS-Zeiger ist weg.
    expect(Array.from(rein.subarray(2, 2 + erwartet.length))).not.toContain(
      0x88,
    );
  });

  it("schreibt fuer die Normalausrichtung gar keinen Abschnitt", () => {
    const roh = bytes(
      [0xff, 0xd8],
      segment(0xe1, [...EXIF, ...tiff([[0x0112, 1]])]),
      SOS,
      BILDDATEN,
    );
    const rein = stripImageMetadata(roh, "image/jpeg");
    expect(Array.from(rein)).toEqual([0xff, 0xd8, ...SOS, ...BILDDATEN]);
  });

  it("behaelt Farbprofil und JFIF, entfernt XMP, IPTC und Kommentar", () => {
    // Ohne APP2 kaeme das Bild verfaerbt heraus.
    const jfif = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01]);
    const icc = segment(0xe2, [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f]);
    const xmp = segment(0xe1, [
      0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x6e, 0x73, 0x99,
    ]);
    const iptc = segment(0xed, [0x38, 0x42, 0x49, 0x4d]);
    const komm = segment(0xfe, [0x48, 0x61, 0x6c, 0x6c, 0x6f]);
    const roh = bytes([0xff, 0xd8], jfif, icc, xmp, iptc, komm, SOS, BILDDATEN);
    const rein = stripImageMetadata(roh, "image/jpeg");
    expect(Array.from(rein)).toEqual([
      0xff,
      0xd8,
      ...jfif,
      ...icc,
      ...SOS,
      ...BILDDATEN,
    ]);
  });

  it("laesst eine Datei ohne Metadaten unveraendert (dieselbe Referenz)", () => {
    const roh = bytes([0xff, 0xd8], segment(0xe0, [0x4a]), SOS, BILDDATEN);
    expect(stripImageMetadata(roh, "image/jpeg")).toBe(roh);
  });

  it("laesst Kaputtes in Ruhe, statt es zu verschlimmern", () => {
    // GRUNDREGEL: ein nicht entferntes Metadatum ist der Zustand von
    // vorher, eine zerschriebene Datei waere neuer Schaden.
    const abgeschnitten = bytes(
      [0xff, 0xd8],
      segment(0xe1, [...EXIF, ...tiff([[0x8825, 1]])]),
    ); // kein SOS
    expect(stripImageMetadata(abgeschnitten, "image/jpeg")).toBe(abgeschnitten);

    const luegenLaenge = bytes([0xff, 0xd8], [0xff, 0xe1, 0x7f, 0xff], SOS);
    expect(stripImageMetadata(luegenLaenge, "image/jpeg")).toBe(luegenLaenge);

    const keinJpeg = bytes([0x00, 0x01, 0x02]);
    expect(stripImageMetadata(keinJpeg, "image/jpeg")).toBe(keinJpeg);
  });

  it("fasst die Bilddaten nicht an, auch wenn sie wie Marker aussehen", () => {
    // Ab SOS stehen Bytefolgen, die Markern gleichen. Wer dort
    // weiterliest, zerschneidet das Bild.
    const daten = [0xff, 0xe1, 0x00, 0x08, 0x11, 0x22, 0xff, 0xd9];
    const roh = bytes(
      [0xff, 0xd8],
      segment(0xe1, [...EXIF, ...tiff([[0x8825, 1]])]),
      SOS,
      daten,
    );
    const rein = stripImageMetadata(roh, "image/jpeg");
    const abSos = Array.from(rein).slice(2);
    expect(abSos).toEqual([...SOS, ...daten]);
  });
});

describe("stripImageMetadata() fuer PNG", () => {
  const SIGNATUR = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  /** PNG-Block: Laenge, Name, Nutzlast, Pruefsumme (hier fest). */
  function block(name: string, nutz: number[]): number[] {
    const n = nutz.length;
    return [
      (n >> 24) & 0xff,
      (n >> 16) & 0xff,
      (n >> 8) & 0xff,
      n & 0xff,
      ...Array.from(name, (c) => c.charCodeAt(0)),
      ...nutz,
      0xde,
      0xad,
      0xbe,
      0xef,
    ];
  }

  it("entfernt eXIf und die Textbloecke, behaelt Bild und Rahmen", () => {
    const ihdr = block("IHDR", [1, 2, 3, 4]);
    const exif = block("eXIf", [0x49, 0x49, 0x2a, 0x00]);
    const text = block("tEXt", [0x41, 0x00, 0x42]);
    const idat = block("IDAT", [9, 9, 9]);
    const iend = block("IEND", []);
    const roh = bytes(SIGNATUR, ihdr, exif, text, idat, iend);
    const rein = stripImageMetadata(roh, "image/png");
    expect(Array.from(rein)).toEqual([...SIGNATUR, ...ihdr, ...idat, ...iend]);
  });

  it("laesst die Pruefsummen der behaltenen Bloecke unberuehrt", () => {
    // Ganze Bloecke wegzulassen heisst: nichts nachzurechnen.
    const idat = block("IDAT", [1, 2, 3, 4, 5]);
    const roh = bytes(
      SIGNATUR,
      block("IHDR", [0]),
      block("iTXt", [7]),
      idat,
      block("IEND", []),
    );
    const rein = stripImageMetadata(roh, "image/png");
    const idatHash = createHash("sha256").update(new Uint8Array(idat)).digest("hex");
    const drin = Array.from(rein).join(",").includes(idat.join(","));
    expect(drin).toBe(true);
    expect(idatHash).toHaveLength(64);
  });

  it("laesst eine abgeschnittene Datei unveraendert", () => {
    const roh = bytes(SIGNATUR, block("IHDR", [0]), block("eXIf", [1]));
    expect(stripImageMetadata(roh, "image/png")).toBe(roh);
  });
});

describe("stripImageMetadata() fuer WebP", () => {
  /** RIFF-Block mit Auffuellung auf gerade Laenge. */
  function chunk(name: string, nutz: number[]): number[] {
    const n = nutz.length;
    return [
      ...Array.from(name, (c) => c.charCodeAt(0)),
      n & 0xff,
      (n >> 8) & 0xff,
      (n >> 16) & 0xff,
      (n >> 24) & 0xff,
      ...nutz,
      ...(n % 2 ? [0x00] : []),
    ];
  }

  function riff(inhalt: number[]): Uint8Array {
    const groesse = inhalt.length + 4;
    return bytes(
      Array.from("RIFF", (c) => c.charCodeAt(0)),
      [
        groesse & 0xff,
        (groesse >> 8) & 0xff,
        (groesse >> 16) & 0xff,
        (groesse >> 24) & 0xff,
      ],
      Array.from("WEBP", (c) => c.charCodeAt(0)),
      inhalt,
    );
  }

  it("entfernt EXIF und XMP und zieht Groesse und Flaggen mit", () => {
    // Bleiben die Flaggen stehen, sucht ein Leser nach Bloecken, die es
    // nicht mehr gibt; stimmt die RIFF-Groesse nicht, halten Decoder die
    // Datei fuer abgeschnitten.
    const vp8x = chunk("VP8X", [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const bild = chunk("VP8 ", [1, 2, 3, 4]);
    const roh = riff([
      ...vp8x,
      ...chunk("EXIF", [0x49, 0x49, 0x2a, 0x00, 0x08]),
      ...chunk("XMP ", [0x3c, 0x78]),
      ...bild,
    ]);
    const rein = stripImageMetadata(roh, "image/webp");

    const groesse =
      rein[4] | (rein[5] << 8) | (rein[6] << 16) | (rein[7] << 24);
    expect(groesse).toBe(rein.length - 8);
    // ICC-Flagge (0x20) bleibt, EXIF (0x08) und XMP (0x04) fallen weg.
    expect(rein[20]).toBe(0x20);
    expect(Array.from(rein).join(",")).toContain(bild.join(","));
    expect(Array.from(rein).join(",")).not.toContain(
      chunk("XMP ", [0x3c, 0x78]).join(","),
    );
  });

  it("laesst ein WebP ohne Metadaten unveraendert", () => {
    const roh = riff(chunk("VP8 ", [1, 2, 3, 4]));
    expect(stripImageMetadata(roh, "image/webp")).toBe(roh);
  });
});

describe("stripImageMetadata() fuer alles andere", () => {
  it("fasst GIF und unbekannte Typen nicht an", () => {
    // In GIF steuern dieselben Erweiterungsbloecke auch die Bildfolge,
    // und ein Foto mit GPS-Ort ist kein GIF.
    const gif = bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(stripImageMetadata(gif, "image/gif")).toBe(gif);
    expect(stripImageMetadata(gif, "application/pdf")).toBe(gif);
  });
});

describe("leseAusrichtung()", () => {
  it("liest beide Byte-Reihenfolgen und weist Unsinn ab", () => {
    expect(leseAusrichtung(new Uint8Array(tiff([[0x0112, 8]])))).toBe(8);
    expect(leseAusrichtung(new Uint8Array(tiff([[0x0112, 9]])))).toBe(null);
    expect(leseAusrichtung(new Uint8Array(tiff([[0x010f, 3]])))).toBe(null);
    expect(leseAusrichtung(new Uint8Array([0x49, 0x49]))).toBe(null);
    expect(leseAusrichtung(new Uint8Array([0x58, 0x58, 0x2a, 0, 8, 0, 0, 0]))).toBe(
      null,
    );
  });
});

describe("an echten Bildern aus einem Encoder", () => {
  /**
   * Die drei Dateien in test/fixtures sind ein 64x48-Verlauf, von
   * Pillow geschrieben, mit GPS-Koordinaten, Hersteller, Modell,
   * Aufnahmezeit und Ausrichtung 6 (hochkant).
   *
   * Sie liegen hier, weil selbstgebaute Bytes nur zeigen, dass der Code
   * seine eigene Vorstellung vom Format beherrscht. Ob er auch mit dem
   * zurechtkommt, was ein echter Encoder schreibt, zeigt nur echte
   * Encoder-Ausgabe. Gegengeprueft wurde ausserhalb der Testsuite mit
   * einem Decoder: alle drei Bilder gehen nach dem Entfernen noch auf,
   * Pixel fuer Pixel unveraendert, und tragen nur noch die Ausrichtung.
   */
  const fixture = (name: string) =>
    new Uint8Array(readFileSync(join(__dirname, "../../test/fixtures", name)));

  const faelle = [
    { datei: "foto.jpg", typ: "image/jpeg" },
    { datei: "foto.png", typ: "image/png" },
    { datei: "foto.webp", typ: "image/webp" },
  ] as const;

  it.each(faelle)("entfernt Ort und Geraet aus $datei", ({ datei, typ }) => {
    const roh = fixture(datei);
    const rein = stripImageMetadata(roh, typ);
    const alsText = Buffer.from(rein).toString("latin1");

    expect(Buffer.from(roh).toString("latin1")).toContain("ACME Kamerawerk");
    expect(alsText).not.toContain("ACME Kamerawerk");
    expect(alsText).not.toContain("Modell X");
    expect(alsText).not.toContain("2026:04:01");
    expect(rein.length).toBeLessThan(roh.length);
  });

  it.each(faelle)("rettet die Ausrichtung aus $datei", ({ datei, typ }) => {
    // Ohne sie laege das Bild nach dem Hochladen auf der Seite.
    const rein = stripImageMetadata(fixture(datei), typ);
    const alsText = Buffer.from(rein).toString("latin1");
    const tiffAb = alsText.indexOf("II\x2a\x00");
    expect(tiffAb).toBeGreaterThan(0);
    expect(leseAusrichtung(rein.subarray(tiffAb))).toBe(6);
  });

  it("laesst die JPEG-Bilddaten Byte fuer Byte stehen", () => {
    const roh = fixture("foto.jpg");
    const rein = stripImageMetadata(roh, "image/jpeg");
    const sos = (b: Uint8Array) => {
      const t = Buffer.from(b).toString("latin1");
      return t.indexOf("\xff\xda");
    };
    expect(Array.from(rein.subarray(sos(rein)))).toEqual(
      Array.from(roh.subarray(sos(roh))),
    );
  });

  it("haelt die Struktur der drei Formate ein", () => {
    const jpg = stripImageMetadata(fixture("foto.jpg"), "image/jpeg");
    expect(Array.from(jpg.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(jpg.subarray(-2))).toEqual([0xff, 0xd9]);

    const png = stripImageMetadata(fixture("foto.png"), "image/png");
    expect(Buffer.from(png).toString("latin1")).toMatch(/IEND....$/s);

    const webp = stripImageMetadata(fixture("foto.webp"), "image/webp");
    const groesse =
      webp[4] | (webp[5] << 8) | (webp[6] << 16) | (webp[7] << 24);
    expect(groesse).toBe(webp.length - 8);
  });
});
