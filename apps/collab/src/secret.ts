/**
 * Secret, mit dem die Web-App die Collab-Tickets signiert.
 *
 * Sicher als Vorgabe: ohne eigenes, ausreichend langes APP_SECRET startet
 * der Collab-Server nur, wenn NODE_ENV ausdruecklich "development" ist.
 * Vorher genuegte jedes NODE_ENV ausser "production" — auch ein
 * fehlendes. Ein von Hand gestarteter Server (`pnpm --filter
 * @dokunc/collab start`, eigener Dienst, eigenes Image ohne NODE_ENV)
 * pruefte Tickets dann still mit dem Entwicklungs-Secret, das in diesem
 * Repository steht: jeder koennte sich Tickets fuer beliebige Seiten und
 * Personen selbst ausstellen.
 *
 * `pnpm dev` setzt NODE_ENV fuer den Collab-Server deshalb selbst (siehe
 * package.json). Das Entwicklungs-Secret ist dasselbe wie in
 * apps/web/src/lib/secret.ts: unter `next dev` signiert die Web-App ohne
 * APP_SECRET damit, und beide Seiten muessen dasselbe verwenden.
 */
export const DEV_FALLBACK_SECRET = "dev-only-insecure-secret-change-me-32+chars";

export function resolveAppSecret(
  secret: string | undefined,
  nodeEnv: string | undefined,
): string {
  if (secret && secret.length >= 32) return secret;
  if (nodeEnv === "development") return DEV_FALLBACK_SECRET;
  throw new Error(
    "APP_SECRET fehlt oder ist zu kurz (min. 32 Zeichen). Ohne eigenes " +
      "Secret startet der Collab-Server nur mit NODE_ENV=development.",
  );
}
