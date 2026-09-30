"use client";

import { useEffect } from "react";
import { removeAllLocalDocs } from "@/lib/local-doc";
import { sessionEndedPath, shouldCompleteSessionEnd } from "@/lib/session-end";

/** Zeitpunkt des letzten Wegs nach /session-ended in diesem Tab. */
const VERSUCH = "dokunc:sitzungsende-versuch";

function leseVersuch(): number | null {
  try {
    const wert = Number(window.sessionStorage.getItem(VERSUCH));
    return Number.isFinite(wert) && wert > 0 ? wert : null;
  } catch {
    return null;
  }
}

function merkeVersuch(jetzt: number): boolean {
  try {
    window.sessionStorage.setItem(VERSUCH, String(jetzt));
    return true;
  } catch {
    return false;
  }
}

/**
 * Loescht auf der Anmeldeseite alle lokalen Kopien der Seiten (IndexedDB)
 * in diesem Browser: ohne gueltige Sitzung gibt es keine. Das ist der
 * Weg, der auch ohne Clear-Site-Data wirkt, also ueber reines HTTP.
 *
 * Kam der Browser ohne den Kopf hierher, obwohl eine Sitzung endete
 * (noch ein Sitzungs-Cookie da oder gerade noch Kopien: weiche
 * Navigation, Link von einer fremden Seite, Ende durch zu viele falsche
 * Passwoerter), laedt die Seite danach /session-ended als Dokument. Dort
 * leert Clear-Site-Data auch den HTTP-Cache mit Dateien geschuetzter
 * Seiten. Nur ueber HTTPS und localhost und hoechstens einmal je Minute
 * und Tab (lib/session-end). Ziel und SSO-Hinweis der Anmeldeseite
 * (`next`, `sso`) gehen mit und kommen zurueck. Zeigt nichts.
 */
export function LocalDataCleanup({
  sitzungsCookie = false,
  next,
  sso,
}: {
  sitzungsCookie?: boolean;
  next?: string;
  sso?: string;
}) {
  useEffect(() => {
    let aktiv = true;
    void removeAllLocalDocs().then((geloescht) => {
      if (!aktiv) return;
      const jetzt = Date.now();
      const nachholen = shouldCompleteSessionEnd({
        cookie: sitzungsCookie,
        removedCopies: geloescht.length,
        secureContext: window.isSecureContext,
        lastAttempt: leseVersuch(),
        now: jetzt,
      });
      // Ohne gemerkten Versuch nie: sonst droht eine Schleife, falls weder
      // Cookie noch Kopf wirken.
      if (nachholen && merkeVersuch(jetzt)) {
        window.location.replace(sessionEndedPath({ next, sso }));
      }
    });
    return () => {
      aktiv = false;
    };
  }, [sitzungsCookie, next, sso]);
  return null;
}
