import { describe, expect, it } from "vitest";
import type { DocSizeNotice } from "@dokunc/editor";
import {
  TOO_LARGE_DISCARD_LABEL,
  TOO_LARGE_NOTICE,
  docSizeBanner,
} from "./doc-size-notice";

const MiB = 1024 * 1024;

function notice(level: DocSizeNotice["level"], bytes: number): DocSizeNotice {
  return { type: "dokunc:doc-size", level, bytes, limitBytes: 16 * MiB };
}

/** Schweizer Rechtschreibung, keine Gedankenstriche als Satzzeichen. */
function pruefeText(text: string) {
  expect(text).not.toMatch(/ß/);
  expect(text).not.toMatch(/ [–—-] /);
}

describe("docSizeBanner()", () => {
  it("ohne Hinweis und bei ok: nichts", () => {
    expect(docSizeBanner(null)).toBeNull();
    expect(docSizeBanner(notice("ok", 1 * MiB))).toBeNull();
  });

  it("warn: ruhiger Hinweis mit beiden Groessen", () => {
    const b = docSizeBanner(notice("warn", 9 * MiB));
    expect(b?.tone).toBe("hinweis");
    expect(b?.text).toContain("9 MB");
    expect(b?.text).toContain("16 MB");
    expect(b?.text).toMatch(/Unterseiten/);
  });

  it("frozen: Sperre, nur noch lesbar, Ausweg ueber den Verlauf", () => {
    const b = docSizeBanner(notice("frozen", 17 * MiB));
    expect(b?.tone).toBe("sperre");
    expect(b?.text).toContain("17 MB");
    expect(b?.text).toContain("16 MB");
    expect(b?.text).toMatch(/nur noch gelesen/);
    expect(b?.text).toMatch(/Verlauf/);
  });

  it("alle Texte ohne ß und ohne Gedankenstriche", () => {
    for (const level of ["warn", "frozen"] as const) {
      pruefeText(docSizeBanner(notice(level, 9 * MiB))?.text ?? "");
    }
    pruefeText(TOO_LARGE_NOTICE);
    pruefeText(TOO_LARGE_DISCARD_LABEL);
    expect(TOO_LARGE_NOTICE).toMatch(/zu gross/);
    expect(TOO_LARGE_NOTICE).toMatch(/verloren/);
    expect(TOO_LARGE_DISCARD_LABEL).toBe(
      "Lokale Änderung verwerfen und neu laden",
    );
  });
});
