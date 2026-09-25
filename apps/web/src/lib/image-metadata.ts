/**
 * Metadaten aus hochgeladenen Bildern entfernen.
 *
 * Die Bytes gingen unveraendert auf die Platte. Ein Foto behielt damit
 * seine EXIF-Daten — GPS-Ort, Aufnahmezeit, Geraet, oft auch eine
 * Vorschau des urspruenglichen Bildes — und /api/files, der Freigabelink
 * und der Export lieferten es genauso wieder aus. Wer ein Bild in eine
 * Seite zieht, teilt damit womoeglich mehr, als er sieht.
 *
 * Neu geschrieben wird hier nichts: kein Neucodieren, keine
 * Bildbibliothek. Es werden nur ganze Abschnitte des Containers
 * weggelassen, die Bilddaten selbst bleiben Byte fuer Byte dieselben.
 *
 * Die eine Angabe, die erhalten bleiben MUSS, ist die Ausrichtung: ohne
 * sie liegt jedes Hochkant-Foto aus einem Telefon auf der Seite. Sie
 * wird deshalb ausgelesen und als frischer, winziger EXIF-Abschnitt neu
 * geschrieben — mit genau diesem einen Eintrag und ohne Verweise, sodass
 * keine Offsets nachzuziehen sind.
 *
 * GRUNDREGEL: Im Zweifel bleibt die Datei, wie sie ist. Jede Stelle, an
 * der die Struktur nicht aufgeht, gibt die Eingabe unveraendert zurueck.
 * Ein nicht entferntes Metadatum ist der Zustand von vorher; eine
 * zerschriebene Datei waere neuer Schaden.
 */

/** "Exif\0\0" — Kennung des EXIF-Abschnitts in JPEG. */
const EXIF_KENNUNG = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
/** "http://ns.adobe.com/xap/1.0/\0" — XMP im selben Markertyp. */
const XMP_KENNUNG = [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x6e, 0x73];

/** EXIF-Tag der Ausrichtung. */
const TAG_ORIENTIERUNG = 0x0112;

function beginntMit(b: Uint8Array, muster: number[]): boolean {
  if (b.length < muster.length) return false;
  return muster.every((v, i) => b[i] === v);
}

function verbinde(teile: Uint8Array[]): Uint8Array {
  const gesamt = teile.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(gesamt);
  let pos = 0;
  for (const t of teile) {
    out.set(t, pos);
    pos += t.length;
  }
  return out;
}

/**
 * Ausrichtung aus einem TIFF-Kopf lesen (1 bis 8, sonst null).
 *
 * Gelesen wird nur IFD0 und nur dieser eine Eintrag. Alles andere —
 * GPS-Zeiger, Hersteller-Notizen, Vorschaubild — interessiert nicht,
 * weil es ohnehin nicht uebernommen wird.
 */
export function leseAusrichtung(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const klein =
    tiff[0] === 0x49 && tiff[1] === 0x49
      ? true
      : tiff[0] === 0x4d && tiff[1] === 0x4d
        ? false
        : null;
  if (klein === null) return null;
  const u16 = (o: number) =>
    klein ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1];
  const u32 = (o: number) =>
    klein
      ? (tiff[o] |
          (tiff[o + 1] << 8) |
          (tiff[o + 2] << 16) |
          (tiff[o + 3] << 24)) >>>
        0
      : ((tiff[o] << 24) |
          (tiff[o + 1] << 16) |
          (tiff[o + 2] << 8) |
          tiff[o + 3]) >>>
        0;

  if (u16(2) !== 42) return null;
  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return null;
  const anzahl = u16(ifd0);
  // Ein IFD mit absurd vielen Eintraegen ist kaputt, nicht gross.
  if (anzahl > 512 || ifd0 + 2 + anzahl * 12 > tiff.length) return null;
  for (let i = 0; i < anzahl; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) !== TAG_ORIENTIERUNG) continue;
    // Typ 3 (SHORT), Anzahl 1: der Wert steht inline im Eintrag.
    if (u16(e + 2) !== 3 || u32(e + 4) !== 1) return null;
    const wert = u16(e + 8);
    return wert >= 1 && wert <= 8 ? wert : null;
  }
  return null;
}

/**
 * Ein frischer TIFF-Block mit ausschliesslich der Ausrichtung.
 *
 * Feste 26 Byte, alles inline: TIFF-Kopf, ein IFD mit einem Eintrag,
 * kein naechstes IFD. Weil nichts auf Daten ausserhalb zeigt, gibt es
 * keine Offsets, die beim Kuerzen falsch wuerden — der haeufigste Weg,
 * eine EXIF-Struktur beim Umschreiben zu zerstoeren.
 *
 * Alle drei Formate tragen dieselben TIFF-Bytes, nur anders verpackt:
 * JPEG in einem APP1-Marker mit "Exif\0\0" davor, PNG in einem
 * eXIf-Block, WebP in einem EXIF-Block.
 */
export function baueTiffAusrichtung(ausrichtung: number): Uint8Array {
  const t = new Uint8Array(8 + 2 + 12 + 4);
  t.set([0x49, 0x49, 0x2a, 0x00], 0); // TIFF-Kopf, little endian
  t.set([0x08, 0x00, 0x00, 0x00], 4); // IFD0 bei Offset 8
  t.set([0x01, 0x00], 8); // ein Eintrag
  t.set([0x12, 0x01], 10); // Tag 0x0112
  t.set([0x03, 0x00], 12); // Typ SHORT
  t.set([0x01, 0x00, 0x00, 0x00], 14); // Anzahl 1
  t.set([ausrichtung & 0xff, 0x00, 0x00, 0x00], 18); // Wert inline
  t.set([0x00, 0x00, 0x00, 0x00], 22); // kein naechstes IFD
  return t;
}

/** Derselbe Block als JPEG-APP1-Abschnitt. */
export function baueAusrichtungsSegment(ausrichtung: number): Uint8Array {
  const nutz = verbinde([
    new Uint8Array(EXIF_KENNUNG),
    baueTiffAusrichtung(ausrichtung),
  ]);
  const laenge = nutz.length + 2;
  return verbinde([
    new Uint8Array([0xff, 0xe1, (laenge >> 8) & 0xff, laenge & 0xff]),
    nutz,
  ]);
}

/**
 * CRC-32 wie PNG ihn verlangt.
 *
 * Gebraucht nur fuer den EINEN Block, den diese Datei neu schreibt: den
 * mit der geretteten Ausrichtung. Alle uebrigen Bloecke werden
 * unveraendert uebernommen und behalten ihre eigene Pruefsumme.
 */
function crc32(daten: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < daten.length; i++) {
    c ^= daten[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Der Ausrichtungs-Block als PNG-eXIf-Block, mit gueltiger Pruefsumme. */
function bauePngAusrichtung(ausrichtung: number): Uint8Array {
  const tiff = baueTiffAusrichtung(ausrichtung);
  const name = new Uint8Array([0x65, 0x58, 0x49, 0x66]); // "eXIf"
  const koerper = verbinde([name, tiff]);
  const summe = crc32(koerper);
  const n = tiff.length;
  return verbinde([
    new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]),
    koerper,
    new Uint8Array([
      (summe >>> 24) & 0xff,
      (summe >>> 16) & 0xff,
      (summe >>> 8) & 0xff,
      summe & 0xff,
    ]),
  ]);
}

/**
 * JPEG: EXIF, XMP, IPTC und Kommentare weglassen, Ausrichtung retten.
 *
 * Behalten werden APP0 (JFIF), APP2 (ICC-Farbprofil) und APP14 (Adobe) —
 * ohne das Farbprofil kaeme ein Bild verfaerbt heraus. Ab SOS wird der
 * Rest unangetastet uebernommen; dort liegen die Bilddaten, und in ihnen
 * stehen Bytefolgen, die wie Marker aussehen.
 */
function entferneJpeg(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return b;
  const teile: Uint8Array[] = [];
  let ausrichtung: number | null = null;
  let geaendert = false;
  let i = 2;
  let sosGefunden = false;

  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return b;
    const marker = b[i + 1];
    // Fuellbytes zwischen Segmenten sind erlaubt.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      teile.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xda) {
      teile.push(b.subarray(i));
      sosGefunden = true;
      break;
    }
    if (i + 3 >= b.length) return b;
    const laenge = (b[i + 2] << 8) | b[i + 3];
    if (laenge < 2 || i + 2 + laenge > b.length) return b;
    const nutz = b.subarray(i + 4, i + 2 + laenge);

    const istExif = marker === 0xe1 && beginntMit(nutz, EXIF_KENNUNG);
    const istXmp = marker === 0xe1 && beginntMit(nutz, XMP_KENNUNG);
    // APP13 traegt IPTC/Photoshop, COM einen freien Kommentar.
    const istIptc = marker === 0xed;
    const istKommentar = marker === 0xfe;

    if (istExif) {
      ausrichtung ??= leseAusrichtung(nutz.subarray(EXIF_KENNUNG.length));
      geaendert = true;
    } else if (istXmp || istIptc || istKommentar) {
      geaendert = true;
    } else {
      teile.push(b.subarray(i, i + 2 + laenge));
    }
    i += 2 + laenge;
  }

  // Ohne SOS ist die Datei abgeschnitten: nicht anfassen.
  if (!sosGefunden || !geaendert) return b;

  const kopf: Uint8Array[] = [b.subarray(0, 2)];
  // Ausrichtung 1 ist "normal" und braucht keinen Eintrag.
  if (ausrichtung !== null && ausrichtung !== 1) {
    kopf.push(baueAusrichtungsSegment(ausrichtung));
  }
  return verbinde([...kopf, ...teile]);
}

/** PNG-Bloecke, die nur beschreiben und nichts darstellen. */
const PNG_WEG = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/**
 * PNG: beschreibende Bloecke weglassen.
 *
 * Ein PNG besteht aus laengenpraefixierten Bloecken mit eigener
 * Pruefsumme. Ganze Bloecke wegzulassen laesst die Pruefsummen der
 * uebrigen unberuehrt — es ist nichts nachzurechnen.
 */
function entfernePng(b: Uint8Array): Uint8Array {
  if (b.length < 8) return b;
  const bloecke: Uint8Array[] = [];
  let geaendert = false;
  let ausrichtung: number | null = null;
  /** Stelle direkt hinter IHDR — dort darf eXIf stehen. */
  let hinterIhdr = 0;
  let i = 8;
  let iendGefunden = false;

  while (i + 8 <= b.length) {
    const laenge =
      ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const ende = i + 12 + laenge;
    if (laenge > b.length || ende > b.length) return b;
    const name = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (PNG_WEG.has(name)) {
      if (name === "eXIf") {
        // Im PNG steht der rohe TIFF-Block, ohne "Exif\0\0" davor.
        ausrichtung ??= leseAusrichtung(b.subarray(i + 8, ende - 4));
      }
      geaendert = true;
    } else {
      bloecke.push(b.subarray(i, ende));
      if (name === "IHDR") hinterIhdr = bloecke.length;
    }
    i = ende;
    if (name === "IEND") {
      iendGefunden = true;
      break;
    }
  }

  if (!iendGefunden || !geaendert) return b;
  if (ausrichtung !== null && ausrichtung !== 1) {
    bloecke.splice(hinterIhdr, 0, bauePngAusrichtung(ausrichtung));
  }
  return verbinde([b.subarray(0, 8), ...bloecke]);
}

/** WebP-Bloecke mit Metadaten. */
const WEBP_WEG = new Set(["EXIF", "XMP "]);
/** Flaggen im VP8X-Block: EXIF vorhanden, XMP vorhanden. */
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

/**
 * WebP: EXIF- und XMP-Bloecke weglassen und die Flaggen mitziehen.
 *
 * Die RIFF-Groesse im Kopf muss stimmen, sonst halten Decoder die Datei
 * fuer abgeschnitten. Und die Flaggen im VP8X-Block muessen mit, sonst
 * sucht ein Leser nach Bloecken, die es nicht mehr gibt.
 */
function entferneWebp(b: Uint8Array): Uint8Array {
  if (b.length < 12) return b;
  const kennung = String.fromCharCode(...b.subarray(0, 4));
  const form = String.fromCharCode(...b.subarray(8, 12));
  if (kennung !== "RIFF" || form !== "WEBP") return b;

  const teile: Uint8Array[] = [];
  let geaendert = false;
  let ausrichtung: number | null = null;
  let vp8x: Uint8Array | null = null;
  let i = 12;
  while (i + 8 <= b.length) {
    const name = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const laenge =
      (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    // Bloecke sind auf gerade Laenge aufgefuellt.
    const ende = i + 8 + laenge + (laenge % 2);
    if (laenge > b.length || ende > b.length) return b;
    if (WEBP_WEG.has(name)) {
      if (name === "EXIF") {
        // Roher TIFF-Block; manche Schreiber setzen "Exif\0\0" davor.
        const nutz = b.subarray(i + 8, i + 8 + laenge);
        ausrichtung ??= leseAusrichtung(
          beginntMit(nutz, EXIF_KENNUNG)
            ? nutz.subarray(EXIF_KENNUNG.length)
            : nutz,
        );
      }
      geaendert = true;
    } else if (name === "VP8X" && laenge >= 1) {
      vp8x = b.slice(i, ende);
      teile.push(vp8x);
    } else {
      teile.push(b.subarray(i, ende));
    }
    i = ende;
  }
  if (i !== b.length || !geaendert) return b;

  // Die Ausrichtung retten, wenn sie etwas aussagt. Browser richten
  // WebP danach aus; ohne sie laege ein Hochkant-Foto auf der Seite.
  if (ausrichtung !== null && ausrichtung !== 1) {
    const tiff = baueTiffAusrichtung(ausrichtung);
    const n = tiff.length;
    teile.push(
      verbinde([
        new Uint8Array([
          0x45, 0x58, 0x49, 0x46, // "EXIF"
          n & 0xff,
          (n >> 8) & 0xff,
          (n >> 16) & 0xff,
          (n >> 24) & 0xff,
        ]),
        tiff,
        ...(n % 2 ? [new Uint8Array([0x00])] : []),
      ]),
    );
  }

  // Die Flaggen im VP8X-Block muessen mitziehen, sonst sucht ein Leser
  // nach Bloecken, die es nicht mehr gibt — oder uebersieht den neuen.
  if (vp8x) {
    vp8x[8] &= ~(VP8X_EXIF | VP8X_XMP);
    if (ausrichtung !== null && ausrichtung !== 1) vp8x[8] |= VP8X_EXIF;
  }

  const inhalt = verbinde(teile);
  const kopf = new Uint8Array(12);
  kopf.set(b.subarray(0, 4), 0); // "RIFF"
  const groesse = inhalt.length + 4; // plus "WEBP"
  kopf.set(
    [
      groesse & 0xff,
      (groesse >> 8) & 0xff,
      (groesse >> 16) & 0xff,
      (groesse >> 24) & 0xff,
    ],
    4,
  );
  kopf.set(b.subarray(8, 12), 8); // "WEBP"
  return verbinde([kopf, inhalt]);
}

/**
 * Metadaten entfernen, soweit das Format es zulaesst.
 *
 * GIF bleibt aussen vor: dort stecken Metadaten in Erweiterungsbloecken,
 * die auch die Bildfolge steuern, und ein Foto mit GPS-Ort ist kein GIF.
 * Unbekannte Typen bleiben ebenfalls unveraendert.
 */
export function stripImageMetadata(
  bytes: Uint8Array,
  mimeType: string,
): Uint8Array {
  try {
    if (mimeType === "image/jpeg") return entferneJpeg(bytes);
    if (mimeType === "image/png") return entfernePng(bytes);
    if (mimeType === "image/webp") return entferneWebp(bytes);
    return bytes;
  } catch {
    // Siehe GRUNDREGEL oben: lieber ein Metadatum zu viel als eine
    // Datei, die nicht mehr aufgeht.
    return bytes;
  }
}
