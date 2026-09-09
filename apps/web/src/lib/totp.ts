import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Zeitbasierte Einmalkennwörter nach RFC 6238.
 *
 * Bewusst selbst gerechnet statt als Abhängigkeit: es sind rund
 * fünfzig Zeilen HMAC, die sich gegen die Testvektoren der Norm prüfen
 * lassen — und eine Bibliothek weniger im Anmeldepfad.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Kein gültiges Base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Neues Geheimnis (20 Byte, wie in der Norm empfohlen). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Code für einen Zeitschritt. */
export function totpCode(
  secret: string,
  counter: number,
  digits = TOTP_DIGITS,
): string {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  // 64-Bit-Zähler, big endian. Number reicht bis 2^53 und damit weit
  // über jede realistische Zeitangabe hinaus.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Code für einen Zeitpunkt (Sekunden seit Epoche). */
export function totpAt(
  secret: string,
  epochSeconds: number,
  digits = TOTP_DIGITS,
): string {
  return totpCode(
    secret,
    Math.floor(epochSeconds / TOTP_STEP_SECONDS),
    digits,
  );
}

/**
 * Prüft einen Code und gibt den passenden Zeitschritt zurück (sonst null).
 *
 * `window` erlaubt Nachbarschritte, damit eine leicht falsch gehende
 * Uhr nicht aussperrt. Der Vergleich läuft in konstanter Zeit.
 *
 * Der Zeitschritt ist der Rückgabewert und nicht bloss ein Ja/Nein,
 * weil der Aufrufer ihn festhalten muss: die Norm verlangt, denselben
 * Code kein zweites Mal zu akzeptieren (RFC 6238, Abschnitt 5.2).
 */
export function verifyTotpStep(
  secret: string,
  code: string,
  options: { now?: Date; window?: number; digits?: number } = {},
): number | null {
  const digits = options.digits ?? TOTP_DIGITS;
  const cleaned = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(cleaned)) return null;

  const window = options.window ?? 1;
  const counter = Math.floor(
    (options.now ?? new Date()).getTime() / 1000 / TOTP_STEP_SECONDS,
  );
  for (let drift = -window; drift <= window; drift++) {
    const expected = totpCode(secret, counter + drift, digits);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) return counter + drift;
  }
  return null;
}

/** Wie `verifyTotpStep`, wenn nur das Ja/Nein zählt. */
export function verifyTotp(
  secret: string,
  code: string,
  options: { now?: Date; window?: number; digits?: number } = {},
): boolean {
  return verifyTotpStep(secret, code, options) !== null;
}

/** URI für Authenticator-Apps. */
export function otpauthUri(opts: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Zur Anzeige in Vierergruppen, damit man es abtippen kann. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Wiederherstellungscodes: Klartext für die Anzeige, Hashes für die DB.
 *
 * Zehn Byte, also achtzig Bit. Der Code ersetzt den zweiten Faktor
 * vollständig — er darf nicht schwächer sein als das, wofür er
 * einspringt, auch wenn die Bremse ein Durchprobieren ohnehin
 * aussichtslos macht.
 */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(10).toString("hex").replace(/(.{10})/, "$1-"),
  );
}

/**
 * Einheitliche Form für Wiederherstellungscodes.
 *
 * Gehasht und verglichen wird immer die normalisierte Fassung, damit
 * Grossschreibung, Leerzeichen oder ein vergessener Bindestrich beim
 * Abtippen nicht zur Aussperrung führen.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}
