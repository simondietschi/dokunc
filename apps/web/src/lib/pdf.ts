import "server-only";
import { log } from "./log";

export function gotenbergUrl(): string | null {
  return process.env.GOTENBERG_URL || null;
}

/**
 * HTML -> PDF über Gotenberg (optionaler Compose-Service).
 * Gibt null zurück, wenn Gotenberg nicht konfiguriert/erreichbar ist —
 * der Aufrufer fällt dann auf die Druckansicht (Browser-PDF) zurück.
 */
export async function htmlToPdf(html: string): Promise<Buffer | null> {
  const base = gotenbergUrl();
  if (!base) return null;

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
      { method: "POST", body: form },
    );
    if (!res.ok) {
      log.warn({ status: res.status }, "gotenberg konvertierung fehlgeschlagen");
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    log.warn({ err: String(e) }, "gotenberg nicht erreichbar");
    return null;
  }
}
