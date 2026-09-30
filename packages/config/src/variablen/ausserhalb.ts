import type { Variable } from "../variable";

/**
 * Variablen, die nur Docker Compose, der Proxy (Caddy) oder Skripte
 * lesen. Keine Pruefung beim Start der Server; die Deklaration haelt
 * Beschreibung, Vorgabe und `geheim` fest und laesst den Gleichlauftest
 * sie in .env.example finden. Nach `name` sortiert.
 */
export const AUSSERHALB_VARIABLEN: readonly Variable[] = [];
