import { scrollBlockFor } from "@/lib/comment-anchor";

const INPUT_EVENTS = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

/** Naechster Vorfahre, der selbst senkrecht scrollt, sonst das Dokument. */
function scrollAreaOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Element in den Scrollbereich holen: "start", wenn es hoeher ist als der
 * sichtbare Bereich (langer Thread, sonst laegen Anfang und Ende
 * ausserhalb), sonst in die Mitte.
 */
export function scrollIntoViewFor(el: HTMLElement, behavior: ScrollBehavior): void {
  el.scrollIntoView({
    block: scrollBlockFor(el.offsetHeight, scrollAreaOf(el).clientHeight),
    behavior,
  });
}

/**
 * Haelt ein Element nach einem Sprung aus der Adresse im Bild, solange der
 * Inhalt darueber noch waechst: der Seiteninhalt kommt erst mit dem
 * Abgleich des Editors ins Dokument, Bilder und Diagramme bekommen ihre
 * Hoehe noch spaeter, und Scroll-Anchoring haelt die Lage nicht (bei
 * Scrollposition 0 gibt es keins, und ein wachsender Editor im sichtbaren
 * Bereich ist selbst der Anker). Jede Groessenaenderung im Scrollbereich
 * springt erneut an, ebenso jede Scrollbewegung, die nicht von der Person
 * kommt: Chromium verschiebt den Bereich waehrend des Ladens auch ohne
 * Groessenaenderung und ohne Skript (beobachtet im E2E, scrollTop 483 auf
 * 37 vor dem Abgleich). Eigene Bewegungen gehen immer mit einer Eingabe
 * los und beenden das Festhalten vorher. Schluss nach der ersten eigenen
 * Eingabe (wheel, touchmove, keydown, pointerdown), nach maxMs (Vorgabe
 * 10 000) oder wenn das Element nicht mehr im Dokument ist. Liefert eine
 * Funktion zum Beenden.
 */
export function holdInView(
  el: HTMLElement,
  opts?: { maxMs?: number },
): () => void {
  const area = scrollAreaOf(el);
  let frame = 0;
  let stopped = false;

  const jump = () => {
    frame = 0;
    if (stopped) return;
    if (!el.isConnected) {
      stop();
      return;
    }
    el.scrollIntoView({
      block: scrollBlockFor(el.offsetHeight, area.clientHeight),
      behavior: "auto",
    });
  };

  // Hoechstens ein Sprung je Frame, egal wie viele Meldungen kommen.
  const schedule = () => {
    if (!stopped && !frame) frame = requestAnimationFrame(jump);
  };
  const observer = new ResizeObserver(schedule);
  // Der Scrollbereich selbst aendert seine Groesse nicht, sein Inhalt
  // schon; body faengt Aenderungen ausserhalb (Seite ohne eigenen Bereich).
  for (const child of Array.from(area.children)) observer.observe(child);
  observer.observe(document.body);

  // Der Scrollbereich des Dokuments meldet sein Scrollen am window.
  const scrollTarget: EventTarget =
    area === document.scrollingElement ? window : area;
  scrollTarget.addEventListener("scroll", schedule, { passive: true });

  const listenerOpts = { capture: true, passive: true } as const;
  const timer = setTimeout(() => stop(), opts?.maxMs ?? 10_000);

  function stop() {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    scrollTarget.removeEventListener("scroll", schedule);
    for (const k of INPUT_EVENTS) window.removeEventListener(k, stop, listenerOpts);
    clearTimeout(timer);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  for (const k of INPUT_EVENTS) window.addEventListener(k, stop, listenerOpts);
  return stop;
}
