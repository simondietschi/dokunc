import { expect, type Page } from "@playwright/test";

/**
 * Laedt neu, bis die Bedingung zutrifft.
 *
 * Server-Actions brauchen unter voller Suite-Last spuerbar laenger als
 * ein einzelnes `reload()` abwartet, und die Anzeige haengt zusaetzlich
 * an einer Revalidierung. Geprueft wird hier ohnehin die Persistenz und
 * nicht die Aktualisierung der laufenden Ansicht — ein laengeres
 * Zeitfenster allein wuerde das nicht zuverlaessig treffen.
 */
export async function reloadUntil(
  page: Page,
  check: () => Promise<number | boolean>,
  timeout = 45_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        // Ein `reload()` mitten in einer noch laufenden Navigation
        // bricht ab. Das ist kein Ergebnis, sondern ein Grund, es im
        // naechsten Durchgang noch einmal zu versuchen.
        try {
          await page.reload();
        } catch {
          return 0;
        }
        const value = await check();
        return typeof value === "boolean" ? (value ? 1 : 0) : value;
      },
      { timeout },
    )
    .toBeGreaterThan(0);
}
