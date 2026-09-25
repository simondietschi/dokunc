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
 * importierte. Hier stehen nur die Namen und die Angaben, die zur
 * Aktion selbst gehoeren (siehe `ASSIST_ACTION_DEFS`).
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
 * Wohin das Ergebnis einer Aktion im Dokument kommt:
 * - "replace": ersetzt die Auswahl,
 * - "below": als Hinweisblock unter die Auswahl,
 * - "append": ans Ende des Dokuments.
 */
export type AssistPlacement = "replace" | "below" | "append";

/**
 * Was zur Aktion selbst gehoert und nicht bloss zu ihrer Darstellung
 * oder ihrem Prompt: die Prompts bleiben serverseitig in `lib/ai.ts`,
 * Beschriftung und Symbol stehen in `AiMenu.tsx`.
 *
 * Die Platzierung stand bisher als Namensregel im Menue
 * (`action.startsWith("translate")` ersetzt die Auswahl). Eine neue
 * Aktion "translate_fr" haette die Regel geerbt, eine "rewrite" nicht —
 * ohne dass es beim Bauen auffiel. Als Record ueber `AssistAction`
 * verlangt jetzt jede neue Aktion eine ausdrueckliche Angabe.
 */
export const ASSIST_ACTION_DEFS: Record<
  AssistAction,
  { placement: AssistPlacement }
> = {
  improve: { placement: "replace" },
  summarize: { placement: "below" },
  translate_en: { placement: "replace" },
  translate_de: { placement: "replace" },
  continue: { placement: "append" },
};

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
