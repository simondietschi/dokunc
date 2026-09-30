import "server-only";
import { checkConfigAtStartup } from "@dokunc/config";
import { log } from "@/lib/log";
import { WEB_VARIABLEN } from "./variablen";

/**
 * Prueft die Umgebung der Web-App. Bei einem Fehler endet der Prozess
 * mit Code 78 nach genau einer Logzeile der Stufe 60, die alle Probleme
 * nennt; sonst steht die wirksame Konfiguration (maskiert) im Log.
 * Aufgerufen aus instrumentation.ts, vor allen Hintergrundjobs.
 */
export function checkWebConfig(): Record<string, unknown> {
  return checkConfigAtStartup({
    dienst: "web",
    variablen: WEB_VARIABLEN,
    env: process.env,
    log,
    exit: (code) => process.exit(code),
  });
}
