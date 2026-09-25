import { afterEach, describe, expect, it, vi } from "vitest";
import { Document } from "@hocuspocus/server";
import * as Y from "yjs";
import { StoreWatch } from "./store-watch";

afterEach(() => {
  vi.useRealTimers();
});

describe("StoreWatch", () => {
  it("erfuellt das Warten mit dem Speicherlauf, der die Marke gelesen hat", async () => {
    const watch = new StoreWatch();
    const doc = new Y.Doc();
    const warten = watch.expectStore(doc, 1_000);
    const marke = watch.current(doc);
    watch.stored(doc, marke);
    await expect(warten).resolves.toBeUndefined();
  });

  // Der Kern: ein Speicherlauf, der VOR dem Austausch kodiert hat, darf
  // das Warten nicht erfuellen — er schreibt den alten Stand.
  it("zaehlt einen Speicherlauf nicht, der vor dem Austausch kodiert hat", async () => {
    vi.useFakeTimers();
    const watch = new StoreWatch();
    const doc = new Y.Doc();
    const frueher = watch.current(doc);
    const warten = watch.expectStore(doc, 1_000);
    let erfuellt = false;
    void warten.then(() => (erfuellt = true), () => undefined);
    watch.stored(doc, frueher);
    await vi.advanceTimersByTimeAsync(0);
    expect(erfuellt).toBe(false);
    watch.stored(doc, watch.current(doc));
    await expect(warten).resolves.toBeUndefined();
  });

  // Marken zaehlen ueber das Ende eines Wartens hinaus weiter: ein alter
  // Lauf mit der Marke des vorigen Austauschs zaehlt nicht fuer den neuen.
  it("verwechselt die Marke eines frueheren Austauschs nicht mit der neuen", async () => {
    vi.useFakeTimers();
    const watch = new StoreWatch();
    const doc = new Y.Doc();
    const erstes = watch.expectStore(doc, 1_000);
    const alteMarke = watch.current(doc);
    watch.stored(doc, alteMarke);
    await erstes;

    const zweites = watch.expectStore(doc, 1_000);
    let erfuellt = false;
    void zweites.then(() => (erfuellt = true), () => undefined);
    watch.stored(doc, alteMarke);
    await vi.advanceTimersByTimeAsync(0);
    expect(erfuellt).toBe(false);
    watch.stored(doc, watch.current(doc));
    await expect(zweites).resolves.toBeUndefined();
  });

  it("lehnt sofort ab, wenn der Speicherlauf scheitert", async () => {
    const watch = new StoreWatch();
    const doc = new Y.Doc();
    const warten = watch.expectStore(doc, 1_000);
    const fehler = new Error("Datenbank weg");
    watch.failed(doc, watch.current(doc), fehler);
    await expect(warten).rejects.toBe(fehler);
  });

  it("laesst einen Fehler eines frueheren Laufs nicht durchschlagen", async () => {
    vi.useFakeTimers();
    const watch = new StoreWatch();
    const doc = new Y.Doc();
    const frueher = watch.current(doc);
    const warten = watch.expectStore(doc, 1_000);
    let abgelehnt = false;
    void warten.catch(() => (abgelehnt = true));
    watch.failed(doc, frueher, new Error("alter Lauf"));
    await vi.advanceTimersByTimeAsync(0);
    expect(abgelehnt).toBe(false);
    watch.stored(doc, watch.current(doc));
    await expect(warten).resolves.toBeUndefined();
  });

  it("lehnt ab, wenn in der Frist kein Speicherlauf gelingt", async () => {
    vi.useFakeTimers();
    const watch = new StoreWatch();
    const doc = new Y.Doc();
    const warten = watch.expectStore(doc, 1_000);
    const ergebnis = expect(warten).rejects.toThrow(
      "Stand nicht innerhalb von 1000 ms gespeichert",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await ergebnis;
    // Aufgeraeumt: ohne Wartende keine Marke mehr.
    expect(watch.current(doc)).toBe(0);
  });

  it("trennt die Dokumente", async () => {
    vi.useFakeTimers();
    const watch = new StoreWatch();
    const p1 = new Y.Doc();
    const p2 = new Y.Doc();
    const warten = watch.expectStore(p1, 1_000);
    let erfuellt = false;
    void warten.then(() => (erfuellt = true), () => undefined);
    watch.expectStore(p2, 1_000).catch(() => undefined);
    watch.stored(p2, watch.current(p2));
    await vi.advanceTimersByTimeAsync(0);
    expect(erfuellt).toBe(false);
    watch.stored(p1, watch.current(p1));
    await expect(warten).resolves.toBeUndefined();
  });

  // Hocuspocus kann eine Seite entladen und neu laden: dann gibt es ein
  // neues Dokument mit demselben Namen, gebaut aus dem gespeicherten
  // Stand. Hat der Austausch im alten nie ein Speicherlauf getragen,
  // fehlt er im neuen — dessen Speicherlauf darf nicht als Erfolg zaehlen,
  // auch nicht mit der Marke, die er beim Kodieren liest.
  it("zaehlt den Speicherlauf eines anderen Dokuments derselben Seite nicht", async () => {
    vi.useFakeTimers();
    const watch = new StoreWatch();
    const alt = new Document("seite-1");
    const neu = new Document("seite-1");
    const warten = watch.expectStore(alt, 1_000);
    let erledigt = false;
    void warten.then(
      () => (erledigt = true),
      () => (erledigt = true),
    );

    const marke = watch.current(neu);
    expect(marke).toBe(0);
    watch.stored(neu, marke);
    watch.failed(neu, marke, new Error("anderes Dokument"));
    // Auch mit der Marke des Wartenden: sie gilt nur fuer sein Dokument.
    watch.stored(neu, watch.current(alt));
    await vi.advanceTimersByTimeAsync(0);
    expect(erledigt).toBe(false);

    watch.stored(alt, watch.current(alt));
    await expect(warten).resolves.toBeUndefined();
  });

  // Entladen wird ein Dokument erst, wenn kein Speicherlauf mehr ansteht;
  // danach kommt keiner mehr. Warten bis zum Zeitlimit hiesse nur, dem
  // Doc-Reset die Zeit fuer einen neuen Versuch zu nehmen.
  it("lehnt sofort ab, wenn das Dokument zerstoert wird", async () => {
    vi.useFakeTimers();
    const watch = new StoreWatch();
    const doc = new Document("seite-1");
    const warten = watch.expectStore(doc, 1_000);
    const ergebnis = expect(warten).rejects.toThrow(
      "Dokument entladen, bevor der Stand gespeichert war",
    );
    doc.destroy();
    await ergebnis;
    expect(watch.current(doc)).toBe(0);
  });

  it("meldet sich nach dem letzten Warten wieder vom Dokument ab", async () => {
    const watch = new StoreWatch();
    const doc = new Y.Doc();
    const on = vi.spyOn(doc, "on");
    const off = vi.spyOn(doc, "off");
    const erstes = watch.expectStore(doc, 1_000);
    const zweites = watch.expectStore(doc, 1_000);
    // Einmal angemeldet, gleich wie viele warten.
    expect(on).toHaveBeenCalledTimes(1);
    watch.stored(doc, watch.current(doc));
    await Promise.all([erstes, zweites]);
    expect(off).toHaveBeenCalledWith("destroy", on.mock.calls[0]![1]);
  });
});
