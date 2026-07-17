import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { RetrievedChunk } from "./retrieval";

const MODEL = process.env.AI_MODEL ?? "claude-opus-4-8";

export function aiAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

/**
 * Stabiler System-Prompt (byte-identisch pro Request-Typ) mit
 * cache_control-Breakpoint: Der Prefix wird gecacht, nur Frage/Kontext
 * danach variieren. (Unter der Mindest-Cachegröße des Modells cached
 * die API still nicht — der Marker ist dann wirkungslos, nie schädlich.)
 */
const ASK_SYSTEM = `Du bist der Wissens-Assistent eines internen Team-Wikis (dokunc).
Beantworte Fragen ausschließlich auf Basis der bereitgestellten Wiki-Auszüge.

Regeln:
- Antworte auf Deutsch, klar und knapp.
- Stütze jede Aussage auf die Auszüge. Wenn die Antwort dort nicht steht, sag das offen — rate nicht.
- Verweise auf Quellen im Text als [1], [2] … entsprechend der Nummerierung der Auszüge.
- Keine Informationen erfinden, keine externen Annahmen.`;

export type AskResult = {
  answer: string;
  sources: { pageId: string; title: string }[];
};

export async function askWiki(
  question: string,
  chunks: RetrievedChunk[],
): Promise<AskResult> {
  // Quellen deduplizieren (Reihenfolge = Nummerierung im Kontext).
  const sources: { pageId: string; title: string }[] = [];
  const sourceIndex = new Map<string, number>();
  for (const c of chunks) {
    if (!sourceIndex.has(c.pageId)) {
      sourceIndex.set(c.pageId, sources.length + 1);
      sources.push({ pageId: c.pageId, title: c.pageTitle });
    }
  }

  const context = chunks
    .map(
      (c) =>
        `[${sourceIndex.get(c.pageId)}] Seite „${c.pageTitle}":\n${c.text}`,
    )
    .join("\n\n---\n\n");

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: ASK_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Wiki-Auszüge:\n\n${context}\n\nFrage: ${question}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return {
      answer:
        "Diese Anfrage kann ich nicht beantworten. Formuliere die Frage bitte anders.",
      sources: [],
    };
  }

  const answer = response.content
    .filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    )
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { answer, sources };
}

export const ASSIST_ACTIONS = {
  improve: "Verbessere den folgenden Text sprachlich (Klarheit, Stil, Rechtschreibung). Behalte Bedeutung, Sprache und Ton bei. Gib NUR den überarbeiteten Text zurück, ohne Kommentar.",
  summarize: "Fasse den folgenden Text prägnant zusammen (Stichpunkte oder kurzer Absatz, je nachdem was besser passt). Gib NUR die Zusammenfassung zurück.",
  translate_en: "Übersetze den folgenden Text ins Englische. Gib NUR die Übersetzung zurück.",
  translate_de: "Übersetze den folgenden Text ins Deutsche. Gib NUR die Übersetzung zurück.",
  continue: "Setze den folgenden Wiki-Text sinnvoll fort (1-3 Absätze, gleicher Stil und gleiche Sprache). Gib NUR die Fortsetzung zurück, ohne den Ausgangstext zu wiederholen.",
} as const;

export type AssistAction = keyof typeof ASSIST_ACTIONS;

export function isAssistAction(v: unknown): v is AssistAction {
  return typeof v === "string" && v in ASSIST_ACTIONS;
}

const ASSIST_SYSTEM = `Du bist ein Schreib-Assistent in einem Team-Wiki (dokunc).
Du erhältst eine Aufgabe und einen Text. Antworte ausschließlich mit dem Ergebnis —
keine Einleitungen, keine Meta-Kommentare, kein Markdown-Codeblock um das Ergebnis.`;

export async function assist(
  action: AssistAction,
  text: string,
): Promise<string> {
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: ASSIST_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `${ASSIST_ACTIONS[action]}\n\nText:\n${text}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Anfrage wurde abgelehnt.");
  }

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
