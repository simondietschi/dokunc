import { GEMEINSAME_VARIABLEN, type Variable } from "@dokunc/config";

/**
 * Variablen, die nur der Collab-Server liest. Nach `name` sortiert
 * (apps/web/src/konfiguration.test.ts prueft das). Wie eine Variable
 * dazukommt, steht in packages/config/README.md.
 */
export const NUR_COLLAB_VARIABLEN: readonly Variable[] = [];

/** Alles, was der Collab-Server beim Start prueft. */
export const COLLAB_VARIABLEN: readonly Variable[] = [
  ...GEMEINSAME_VARIABLEN.filter((v) => v.dienste.includes("collab")),
  ...NUR_COLLAB_VARIABLEN,
];
