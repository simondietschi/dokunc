/**
 * Warum ein Konto im Admin-Bereich nicht gesperrt oder freigeschaltet
 * wurde, oder warum es seine Adminrechte behalten hat.
 *
 * toggleUserActiveAction brach an drei Stellen wortlos ab: die Seite
 * kuendigte "deaktivieren" an, und danach passierte nichts. Bei
 * toggleUserAdminAction war es dasselbe. Wie bei der
 * Löschung (lib/account-deletion, adminDeletionMessage) reist der Grund
 * als Kennung in der Adresszeile — nicht als Satz, denn die Adresszeile
 * ist von aussen setzbar, und die Seite soll nur bekannte Texte zeigen.
 *
 * Rein und ohne Datenbank: die Action entscheidet, hier steht nur, wie
 * die Entscheidung heisst und wie sie sich liest.
 */
export type StatusRefusal =
  | "selbst"
  | "unbekannt"
  | "letzter-admin"
  | "letzter-admin-rechte";

const CODES: readonly StatusRefusal[] = [
  "selbst",
  "unbekannt",
  "letzter-admin",
  "letzter-admin-rechte",
];

/** Suchparameter, unter dem die Kennung auf /admin ankommt. */
export const STATUS_REFUSAL_PARAM = "status-unveraendert";

const MESSAGES: Record<StatusRefusal, string> = {
  // Die Seite bietet die Schaltflaeche fuer das eigene Konto gar nicht
  // an; ankommen kann das nur ueber ein von Hand gebautes Formular.
  selbst:
    "Status nicht geändert: Das eigene Konto lässt sich hier nicht deaktivieren.",
  // Zwischen Anzeigen und Abschicken geloescht, etwa von einer zweiten
  // Verwaltung.
  unbekannt: "Status nicht geändert: Dieses Konto gibt es nicht mehr.",
  "letzter-admin":
    "Konto nicht deaktiviert: Es ist der letzte aktive Instanz-Admin. Ernenne zuerst jemand anderen.",
  "letzter-admin-rechte":
    "Adminrechte nicht entzogen: Es ist der letzte aktive Instanz-Admin. Ernenne zuerst jemand anderen.",
};

export function statusRefusalMessage(code: StatusRefusal): string {
  return MESSAGES[code];
}

/** Gehoert die Zeichenkette aus der Adresszeile zu einer bekannten Ablehnung? */
export function isStatusRefusal(value: unknown): value is StatusRefusal {
  return CODES.includes(value as StatusRefusal);
}
