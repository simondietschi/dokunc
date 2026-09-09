import "server-only";
import QRCode from "qrcode";
import { log } from "./log";

/**
 * QR-Code als SVG.
 *
 * Bewusst SVG und kein PNG: das Markup entsteht serverseitig, geht als
 * Text durch die Server-Action und braucht weder Canvas noch eine
 * zweite Anfrage. Der Inhalt kommt aus dem eigenen `otpauthUri`, nicht
 * aus einer Eingabe.
 */
export async function qrSvg(text: string): Promise<string | null> {
  try {
    return await QRCode.toString(text, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
    });
  } catch (e) {
    // Ohne Bild bleibt das Geheimnis zum Abtippen — die Einrichtung
    // scheitert daran nicht.
    log.warn({ err: String(e) }, "QR-Code konnte nicht erzeugt werden");
    return null;
  }
}
