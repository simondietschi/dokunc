"use client";

import { useEffect } from "react";
import { removeAllLocalDocs } from "@/lib/local-doc";

/**
 * Loescht auf der Anmeldeseite alle lokalen Kopien der Seiten (IndexedDB)
 * in diesem Browser: ohne gueltige Sitzung gibt es keine. Das ist der
 * Weg, der auch ohne Clear-Site-Data wirkt, also ueber reines HTTP, nach
 * einer weichen Navigation und wenn Cookie und Sitzung zugleich abliefen.
 * Zeigt nichts.
 */
export function LocalDataCleanup() {
  useEffect(() => {
    void removeAllLocalDocs();
  }, []);
  return null;
}
