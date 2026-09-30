export type { Ergebnis } from "./ergebnis";
export {
  aufzaehlung,
  auswahl,
  defineVariable,
  ganzeZahl,
  type Dienst,
  type Umgebung,
  type Variable,
} from "./variable";
export { checkEnvironment, type Befund, type Pruefbericht } from "./pruefen";
export { ANZEIGE_FEHLGESCHLAGEN, MAX_ANZEIGE, maskValue, maskedConfig } from "./maskieren";
export { EXIT_KONFIGURATION, checkConfigAtStartup, type StartLog } from "./start";
export { LOG_LEVELS, LOG_REDACT, logLevelFrom, parseLogLevel, type LogLevel } from "./log";
export { NOCH_OHNE_SCHEMA } from "./altbestand";
export {
  effectiveSender,
  senderDomain,
  senderText,
  undeliverableDomain,
  type MailAbsender,
} from "./mail-absender";
export {
  ADRESS_HINWEIS,
  AdressMelder,
  MAX_NETWORK_ENTRIES,
  MAX_PROXY_HOPS,
  adressMeldung,
  adressMelderFuerLog,
  normalizeIp,
  parseNetworkList,
  parseProxyHops,
  resolveClientAddress,
  type AdressMeldung,
  type AdressProblem,
  type Aufloesung,
  type NetzListe,
} from "./client-address";
export { GEMEINSAME_VARIABLEN } from "./variablen/gemeinsam";
export { AUSSERHALB_VARIABLEN } from "./variablen/ausserhalb";
