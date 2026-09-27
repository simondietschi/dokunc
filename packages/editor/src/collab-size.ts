/**
 * Groessengrenzen des Collab-Servers.
 *
 * Zwei Grenzen, beide aus der Umgebung (COLLAB_MAX_DOC_MB,
 * COLLAB_MAX_MESSAGE_MB):
 *
 *  - Dokumentgrenze: Groesse des Yjs-Stands einer Seite. Ab der Haelfte
 *    warnen Log und Editor, darueber sperrt der Collab-Server alle
 *    Schreibverbindungen, bis das Dokument wieder kleiner ist.
 *  - Nachrichtengrenze: groesster WebSocket-Frame (maxPayload von ws).
 *    Sie liegt 1 MB ueber der Dokumentgrenze, damit ein Browser eine
 *    erlaubte Seite in einer Nachricht ganz abgleichen kann (SyncStep2,
 *    wenn dem Server der Stand fehlt).
 *
 * Rein und ohne Node-Abhaengigkeit: der Collab-Server setzt die Grenzen
 * durch, die Web-App zeigt sie in der Admin-Liste an.
 *
 * Begruendung der Vorgabe: 16 MB Yjs-Stand sind rund 15 Millionen
 * Zeichen, grosse Seiten entstehen durch Diagramme. Nach oben begrenzt
 * der Arbeitsspeicher (jeder Speicherlauf haelt grob das Zehnfache des
 * Stands); fuer einen Container mit 1 GB nennt die Doku 8 MB.
 */
import { readWholeNumber, type EnvWarn } from "./env-number";

const MB = 1024 * 1024;

/** Vorgabe fuer COLLAB_MAX_DOC_MB. */
export const DEFAULT_MAX_DOC_MB = 16;
/** So viel groesser als die Dokumentgrenze ist die Nachrichtengrenze. */
export const MESSAGE_HEADROOM_BYTES = 1 * MB;
/** Vorgabe von ws fuer maxPayload, gilt ohne Dokumentgrenze wie bisher. */
export const WS_DEFAULT_MAX_PAYLOAD = 100 * MB;

export type DocSizeLimits = {
  /** Ab hier (echt groesser) nur noch lesbar; 0 = keine Grenze. */
  maxDocBytes: number;
  /** Ab hier (groesser oder gleich) Warnung; 0 = keine. */
  warnDocBytes: number;
  /** maxPayload je Frame; 0 = keine Grenze. */
  maxMessageBytes: number;
};

/** ok: unter der Warnschwelle; warn: ab der Haelfte; frozen: nur lesbar. */
export type DocSizeLevel = "ok" | "warn" | "frozen";

const MELDUNG = "Ungueltige Groessengrenze, Vorgabe gilt";

/**
 * Grenzen aus der Umgebung. Leer heisst Vorgabe (still), Unsinn heisst
 * Vorgabe mit Warnung (readWholeNumber). Eine gesetzte Nachrichtengrenze
 * unter Dokumentgrenze plus 1 MB gilt, wird aber gemeldet.
 */
export function readDocSizeLimits(
  env: Record<string, string | undefined>,
  warn: EnvWarn,
): DocSizeLimits {
  const docMb =
    readWholeNumber(env, "COLLAB_MAX_DOC_MB", warn, MELDUNG) ??
    DEFAULT_MAX_DOC_MB;
  const maxDocBytes = docMb * MB;
  const warnDocBytes = Math.floor(maxDocBytes / 2);

  const msgMb = readWholeNumber(env, "COLLAB_MAX_MESSAGE_MB", warn, MELDUNG);
  let maxMessageBytes: number;
  if (msgMb !== undefined) {
    maxMessageBytes = msgMb * MB;
    if (
      msgMb > 0 &&
      maxDocBytes > 0 &&
      maxMessageBytes < maxDocBytes + MESSAGE_HEADROOM_BYTES
    ) {
      warn(
        { variable: "COLLAB_MAX_MESSAGE_MB", wert: String(msgMb) },
        "COLLAB_MAX_MESSAGE_MB liegt unter COLLAB_MAX_DOC_MB plus 1: ein Browser kann eine grosse Seite dann nicht mehr ganz abgleichen",
      );
    }
  } else {
    maxMessageBytes =
      maxDocBytes > 0
        ? maxDocBytes + MESSAGE_HEADROOM_BYTES
        : WS_DEFAULT_MAX_PAYLOAD;
  }
  return { maxDocBytes, warnDocBytes, maxMessageBytes };
}

/** Stufe eines Yjs-Stands mit `bytes` Bytes. */
export function docSizeLevel(
  bytes: number,
  limits: DocSizeLimits,
): DocSizeLevel {
  if (limits.maxDocBytes === 0) return "ok";
  if (bytes > limits.maxDocBytes) return "frozen";
  if (bytes >= limits.warnDocBytes) return "warn";
  return "ok";
}
