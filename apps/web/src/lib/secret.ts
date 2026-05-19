const DEV_FALLBACK = "dev-only-insecure-secret-change-me-32+chars";

/**
 * Liefert das App-Secret. In Produktion MUSS ein eigenes, ausreichend
 * langes Secret gesetzt sein — sonst sind Sessions und die Collab-Auth
 * fälschbar. Reine Funktion, damit testbar.
 */
export function resolveAppSecret(
  secret: string | undefined,
  isProd: boolean,
): string {
  if (isProd) {
    if (!secret || secret.length < 32) {
      throw new Error(
        "APP_SECRET fehlt oder ist zu kurz (min. 32 Zeichen). " +
          "In Produktion zwingend setzen.",
      );
    }
    return secret;
  }
  return secret && secret.length >= 32 ? secret : DEV_FALLBACK;
}

export function getAppSecret(): string {
  return resolveAppSecret(
    process.env.APP_SECRET,
    process.env.NODE_ENV === "production",
  );
}
