/**
 * Warum eine Gruppe ihren Namen behielt.
 *
 * renameGroupAction tat bei zu kurzem oder schon vergebenem Namen
 * stillschweigend nichts: "Speichern" geklickt, Seite neu geladen, alter
 * Name — und niemand erfuhr warum. createGroupAction meldet dieselben
 * Faelle ueber ihren Formularzustand; die Umbenennung hat keinen und
 * meldet deshalb per Umleitung, wie deleteUserAction im Admin-Bereich.
 * Als Kennung, nicht als Satz — die Adresszeile ist von aussen setzbar,
 * und die Seite soll nur bekannte Texte zeigen.
 */
export type RenameRefusal = "zu-kurz" | "vergeben";

/** Suchparameter, unter dem die Kennung auf /admin/groups ankommt. */
export const RENAME_REFUSAL_PARAM = "nicht-umbenannt";

export function renameRefusalMessage(code: RenameRefusal): string {
  return code === "zu-kurz"
    ? "Gruppe nicht umbenannt: Der Name braucht mindestens zwei Zeichen."
    : "Gruppe nicht umbenannt: Eine andere Gruppe trägt diesen Namen schon.";
}

/** Gehoert die Zeichenkette aus der Adresszeile zu einer bekannten Ablehnung? */
export function isRenameRefusal(value: unknown): value is RenameRefusal {
  return value === "zu-kurz" || value === "vergeben";
}
