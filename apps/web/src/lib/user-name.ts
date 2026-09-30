import { z } from "zod";
import { truncateText } from "./text-length";

/**
 * Anzeigename einer Person: EINE Regel fuer Registrierung, Profil und
 * die Konten, die eine SSO-Anmeldung anlegt (`ssoUserName` unten).
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

/**
 * Anzeigename fuer ein Konto, das die SSO-Anmeldung anlegt
 * (lib/oidc-account.ts).
 *
 * Der Anbieter liefert den Namen (Claim `name`, sonst
 * `preferred_username`, siehe readClaims in lib/oidc.ts) ohne jede
 * Grenze. Ungeprueft uebernommen, bekam das Konto einen Namen aus einem
 * einzigen Zeichen oder einen beliebig langen, und das Profilformular,
 * das nur dieses Feld hat, liess sich danach nicht mehr speichern, ohne
 * den Namen zu aendern. Deshalb gilt hier dieselbe Regel: der erste
 * Kandidat, der sie nach dem Kappen auf USER_NAME_MAX Codepoints
 * erfuellt. Gekappt statt verworfen, weil ein langer Name aus dem
 * Verzeichnis vorn meist das Wesentliche traegt. Zuletzt die ganze
 * Adresse: readClaims laesst nur eine ohne Leerraum mit Zeichen links
 * und rechts des "@" durch, sie hat also mindestens drei Zeichen.
 */
export function ssoUserName(name: string | null, email: string): string {
  for (const candidate of [name, email.split("@")[0], email]) {
    if (!candidate) continue;
    const parsed = userNameSchema.safeParse(
      truncateText(candidate.trim(), USER_NAME_MAX),
    );
    if (parsed.success) return parsed.data;
  }
  return truncateText(email, USER_NAME_MAX);
}
