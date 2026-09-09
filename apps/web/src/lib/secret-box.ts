import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getAppSecret } from "./secret";

/**
 * Kleine Hülle für Geheimnisse, die in der Datenbank liegen müssen.
 *
 * Betrifft zurzeit das TOTP-Geheimnis: läge es im Klartext, wäre ein
 * Datenbankabzug allein schon der zweite Faktor. Der Schlüssel kommt
 * aus APP_SECRET, liegt also getrennt von der Datenbank.
 *
 * AES-256-GCM mit zufälligem Nonce; Nonce, Prüfsumme und Text stehen
 * durch Punkte getrennt in einem Feld.
 */
function key(): Buffer {
  return createHash("sha256").update(getAppSecret()).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

/** Gibt null zurück, wenn der Text verändert wurde oder der Schlüssel wechselte. */
export function unseal(sealed: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(parts[0], "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
