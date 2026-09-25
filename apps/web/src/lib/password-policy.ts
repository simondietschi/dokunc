/**
 * Die beiden Zahlen, an denen die Stärke von Passwörtern hängt.
 *
 * Sie standen vorher nackt in jedem zod-Schema und an jedem
 * bcrypt-Aufruf. Wer eine davon anhebt, übersieht so leicht eine
 * Stelle — beim Kostenfaktor besonders folgenreich: die Anmeldung
 * vergleicht auch gegen einen Hash für Adressen ohne Konto, damit die
 * Laufzeit nicht verrät, welche Konten es gibt. Bliebe der bei 10,
 * während die echten Hashes teurer werden, wäre der Unterschied wieder
 * messbar.
 */

/** Mindestlänge für neue Passwörter (Registrierung, Wechsel, Reset). */
export const PASSWORD_MIN_LENGTH = 8;

/** bcrypt-Kostenfaktor für alle Passwort-Hashes dieser Anwendung. */
export const BCRYPT_COST = 10;
