import "server-only";
import { log } from "./log";

export function gotenbergUrl(): string | null {
  return process.env.GOTENBERG_URL || null;
}

/**
 * Zeitgrenze einer Umwandlung. Knapp ueber --api-timeout von Gotenberg
 * (30 s in docker-compose.yml): Gotenberg antwortet vorher selbst mit 503,
 * die Grenze hier greift nur, wenn gar keine (vollstaendige) Antwort
 * kommt (angehaltener Dienst, Netz, fremder Gotenberg ohne Grenze). Ohne
 * sie wartete undici bis zu 300 s auf den Kopf und ebenso lange auf den
 * Koerper, mit dem ganzen HTML im Speicher. pdf.test.ts haelt beide Werte
 * zusammen.
 */
export const PDF_TIMEOUT_MS = 35_000;

/**
 * HTML -> PDF über Gotenberg (optionaler Compose-Service).
 * Gibt null zurück, wenn Gotenberg nicht konfiguriert/erreichbar ist oder
 * nicht innerhalb der Zeitgrenze antwortet — die Export-Route meldet dann
 * 501, die Druckansicht (Browser-PDF) bleibt der Weg.
 */
export async function htmlToPdf(
  html: string,
  opts: { timeoutMs?: number } = {},
): Promise<Buffer | null> {
  const base = gotenbergUrl();
  if (!base) return null;
  const timeoutMs = opts.timeoutMs ?? PDF_TIMEOUT_MS;

  try {
    const form = new FormData();
    form.set(
      "files",
      new File([html], "index.html", { type: "text/html" }),
    );
    form.set("marginTop", "0.6");
    form.set("marginBottom", "0.6");
    form.set("marginLeft", "0.55");
    form.set("marginRight", "0.55");

    const res = await fetch(
      `${base.replace(/\/$/, "")}/forms/chromium/convert/html`,
      // Das Signal begrenzt Kopf und Koerper: arrayBuffer() unten bricht
      // mit demselben TimeoutError ab, wenn der Dienst mitten im PDF
      // stehen bleibt.
      { method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) {
      log.warn({ status: res.status }, "gotenberg konvertierung fehlgeschlagen");
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name === "TimeoutError") {
      log.warn({ err: e, timeoutMs }, "gotenberg antwortet nicht innerhalb der Zeitgrenze");
      return null;
    }
    log.warn({ err: e }, "gotenberg nicht erreichbar");
    return null;
  }
}
