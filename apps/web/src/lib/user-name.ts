import { z } from "zod";

/**
 * Anzeigename einer Person: EINE Regel fuer Registrierung und Profil.
 *
 * Beide Eingaenge prueften bisher je fuer sich, und die Regeln waren
 * auseinandergelaufen. Die Registrierung zaehlte ueber zod Codepoints
 * (seit zod 4.5), das Profil mit `name.length` UTF-16-Einheiten: ein Name
 * aus einem einzelnen Emoji scheiterte am einen und ging am anderen
 * durch. Eine Obergrenze hatte nur die Registrierung; ueber das Profil
 * liess sich danach ein beliebig langer Name setzen, der in jeder
 * Mitgliederliste und als Kommentarautor steht.
 *
 * Getrimmt geprueft: ohne `trim` zaehlte `min` Rohzeichen, zwei
 * Leerzeichen gingen als Name durch, und das Konto stuende ohne
 * sichtbaren Namen da.
 *
 * Ohne "server-only": reine Validierung, nutzbar auch im Client.
 */
export const USER_NAME_MIN = 2;
/** Wie beim Space-Namen (lib/space-settings.ts): ein Name ist eine Zeile. */
export const USER_NAME_MAX = 80;

export const userNameSchema = z
  .string()
  .trim()
  .min(USER_NAME_MIN, "Name zu kurz")
  .max(USER_NAME_MAX, `Name darf höchstens ${USER_NAME_MAX} Zeichen haben`);
