/**
 * Die Namen der KI-Schreibaktionen — die einzige Liste, die Client und
 * Server gemeinsam brauchen.
 *
 * Sie standen bisher zweimal da: als Schluessel von `ASSIST_ACTIONS` in
 * `lib/ai.ts` und als Union-Typ in `components/editor/AiMenu.tsx`. Der
 * Client konnte also eine Aktion anbieten, die der Server nicht kennt —
 * der Menuepunkt lief dann in "KI-Anfrage fehlgeschlagen", ohne dass es
 * beim Bauen aufgefallen waere.
 *
 * Bewusst ein eigenes Modul OHNE "server-only": `lib/ai.ts` importiert
 * das Anthropic-SDK und traegt die Prompt-Texte. Beides gehoert nicht
 * ins Client-Bundle — weder als Gewicht noch als Inhalt —, und der
 * "server-only"-Guard dort wuerde den Build brechen, sobald AiMenu davon
 * importierte. Hier stehen nur die Namen.
 */
export const ASSIST_ACTIONS = [
  "improve",
  "summarize",
  "translate_en",
  "translate_de",
  "continue",
] as const;

export type AssistAction = (typeof ASSIST_ACTIONS)[number];

/**
 * Allowlist-Pruefung fuer die Aktion aus dem Request-Body.
 *
 * Vergleich gegen die Liste statt `in`/`hasOwnProperty` auf einem
 * Objekt: so kommt mit action="toString" nichts aus
 * `Function.prototype` durch, egal wie die Prompts drueben abgelegt
 * sind.
 */
export function isAssistAction(v: unknown): v is AssistAction {
  return (
    typeof v === "string" &&
    (ASSIST_ACTIONS as readonly string[]).includes(v)
  );
}
