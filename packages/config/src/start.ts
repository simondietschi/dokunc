import type { Logger } from "pino";
import { NOCH_OHNE_SCHEMA } from "./altbestand";
import { maskedConfig } from "./maskieren";
import { checkEnvironment } from "./pruefen";
import type { Umgebung, Variable } from "./variable";

/**
 * Exit-Code bei ungueltiger Konfiguration (EX_CONFIG aus sysexits.h).
 * Unterscheidet den Fall von einem Absturz (1) und von SIGKILL (137);
 * `docker inspect` zeigt ihn.
 */
export const EXIT_KONFIGURATION = 78;

export type StartLog = Pick<Logger, "fatal" | "warn" | "info"> & { level: string };

/**
 * Prueft die Konfiguration beim Start eines Servers.
 *
 * - Fehler: Hinweise als warn, dann genau eine Zeile der Stufe 60 mit
 *   allen Fehlern (`errors`), dann `exit(78)`. Steht die Stufe auf
 *   silent, hebt die Funktion sie vorher auf fatal, damit die Zeile
 *   erscheint. Kehrt `exit` zurueck (Tests), wirft sie, damit der
 *   Aufrufer nicht weiterlaeuft.
 * - Erfolg: Hinweise als warn und eine Zeile "Konfiguration geprueft"
 *   mit den wirksamen Werten (`config`, maskiert) und den Namen der
 *   gesetzten, noch ungeprueften Variablen (`unchecked`, ohne Werte:
 *   fuer sie ist noch nicht festgehalten, ob sie geheim sind).
 *
 * Ein Wurf statt exit hielte den Web-Prozess nicht an: `next start`
 * meldet einen Fehler aus `register()` und laeuft weiter.
 */
export function checkConfigAtStartup(o: {
  dienst: "web" | "collab";
  variablen: readonly Variable[];
  env: Umgebung;
  log: StartLog;
  exit: (code: number) => never | void;
}): Record<string, unknown> {
  const bericht = checkEnvironment(o.variablen, o.env, o.dienst);
  for (const h of bericht.hinweise) {
    o.log.warn({ variable: h.variable }, h.meldung);
  }
  if (!bericht.ok) {
    if (o.log.level === "silent") o.log.level = "fatal";
    const anzahl = bericht.fehler.length;
    o.log.fatal(
      { errors: bericht.fehler.map((f) => ({ variable: f.variable, message: f.meldung })) },
      `Konfiguration ungueltig (${anzahl} Fehler), Start abgebrochen: ${bericht.fehler
        .map((f) => f.meldung)
        .join("; ")}`,
    );
    o.exit(EXIT_KONFIGURATION);
    throw new Error("Konfiguration ungueltig, Start abgebrochen");
  }
  const eigene = o.variablen.filter((v) => v.dienste.includes(o.dienst));
  o.log.info(
    {
      config: maskedConfig(eigene, bericht.werte, o.env),
      unchecked: NOCH_OHNE_SCHEMA.filter((n) => (o.env[n] ?? "").trim() !== ""),
    },
    "Konfiguration geprueft",
  );
  return bericht.werte;
}
