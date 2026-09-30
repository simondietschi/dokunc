import { GEMEINSAME_VARIABLEN, type Variable } from "@dokunc/config";

/**
 * Variablen, die nur die Web-App liest. Nach `name` sortiert
 * (konfiguration.test.ts prueft das). Parser liegen beim Code, der den
 * Wert nutzt; wie eine Variable dazukommt, steht in
 * packages/config/README.md.
 *
 * Ohne `import "server-only"`, damit der Gleichlauftest die Liste laden
 * kann; den Schutz traegt ./index.ts.
 */
export const NUR_WEB_VARIABLEN: readonly Variable[] = [];

/** Alles, was die Web-App beim Start prueft. */
export const WEB_VARIABLEN: readonly Variable[] = [
  ...GEMEINSAME_VARIABLEN.filter((v) => v.dienste.includes("web")),
  ...NUR_WEB_VARIABLEN,
];
