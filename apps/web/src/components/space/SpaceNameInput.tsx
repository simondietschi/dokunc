import { Input } from "@/components/ui/Input";
import { SPACE_NAME_MAX, SPACE_NAME_MIN } from "@/lib/space-settings";

/**
 * Namensfeld eines Space: beim Anlegen (Uebersicht, Onboarding, "Noch
 * kein Space") und in den Einstellungen.
 *
 * Eine Komponente wegen `maxLength`. Der Browser zaehlt UTF-16-Einheiten,
 * der Server (spaceSettingsSchema) Codepoints; ein Name aus 41 bis 80
 * Emoji ist auf dem Server gueltig, im Feld mit maxLength=80 aber zu lang.
 * Solange niemand ihn anfasst, laesst der Browser ihn stehen; nach der
 * ersten Bearbeitung meldet er ihn als zu lang und sperrt das Absenden,
 * auch wenn die Bearbeitung ihn gerade gekuerzt hat (lib/text-length).
 * Die Anlage-Felder hatten keine `maxLength`: ein Space mit 50 Emoji
 * liess sich anlegen und danach in den Einstellungen nur noch speichern,
 * wenn man den Namen auf 40 Emoji kuerzte. Mit denselben Grenzen an jedem
 * Feld entsteht ueber die Oberflaeche kein Name, den das Einstellungsfeld
 * sperrt.
 *
 * Ohne "use client": keine Hooks, nutzbar in Server- und
 * Client-Komponenten.
 */
export function SpaceNameInput(
  props: Omit<
    React.ComponentProps<"input">,
    "name" | "required" | "minLength" | "maxLength"
  >,
) {
  return (
    <Input
      {...props}
      name="name"
      required
      minLength={SPACE_NAME_MIN}
      maxLength={SPACE_NAME_MAX}
    />
  );
}
