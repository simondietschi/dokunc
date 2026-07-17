"use server";

import { requireUser } from "@/lib/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { aiAvailable, askWiki } from "@/lib/ai";
import { retrieveChunks } from "@/lib/retrieval";
import { log } from "@/lib/log";

export type AskState =
  | {
      error?: string;
      answer?: string;
      sources?: { pageId: string; title: string }[];
      question?: string;
    }
  | undefined;

export async function askAction(
  _prev: AskState,
  form: FormData,
): Promise<AskState> {
  const user = await requireUser();
  const question = String(form.get("question") ?? "").trim();
  if (question.length < 3) return { error: "Bitte eine Frage eingeben." };
  if (!aiAvailable()) {
    return {
      error:
        "KI ist nicht konfiguriert. Setze ANTHROPIC_API_KEY in der Umgebung.",
    };
  }
  if (!(await rateLimit(`ask:${user.id}`, 20, 3600))) {
    return { error: "Zu viele Anfragen. Bitte später erneut." };
  }

  try {
    const chunks = await retrieveChunks(user.id, question);
    if (chunks.length === 0) {
      return {
        question,
        answer:
          "Dazu habe ich im Wiki nichts gefunden. Formuliere die Frage anders oder lege eine Seite dazu an.",
        sources: [],
      };
    }
    const result = await askWiki(question, chunks);
    return { question, ...result };
  } catch (e) {
    log.error({ err: String(e) }, "askWiki fehlgeschlagen");
    return { error: "KI-Anfrage fehlgeschlagen. Bitte später erneut." };
  }
}
