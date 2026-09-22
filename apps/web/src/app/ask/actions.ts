"use server";

import { requireUser } from "@/lib/current-user";
import { str } from "@/lib/form";
import { rateLimit } from "@/lib/rate-limit";
import { aiAvailable, askWiki } from "@/lib/ai";
import { retrieveChunks } from "@/lib/retrieval";
import { log } from "@/lib/log";
import { RATE_LIMITS } from "@/lib/rate-limits";

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
  // str() statt String(): ein als Datei gesendetes Feld "question" wuerde
  // sonst zu "[object File]" und passierte die Laengenpruefung.
  const question = str(form, "question");
  if (question.length < 3) return { error: "Bitte eine Frage eingeben." };
  // Obergrenze wie in /api/ai/assist: die Frage geht unveraendert an
  // Voyage, in plainto_tsquery und an die Anthropic-API. Ohne sie liesse
  // sich pro Anfrage der ganze erlaubte Server-Action-Koerper (5 MB, s.
  // next.config.ts) an beide externen Dienste weiterreichen.
  if (question.length > 20_000) {
    return { error: "Frage zu lang (max. 20.000 Zeichen)." };
  }
  if (!aiAvailable()) {
    return {
      error:
        "KI ist nicht konfiguriert. Setze ANTHROPIC_API_KEY in der Umgebung.",
    };
  }
  if (!(await rateLimit(
      `ask:${user.id}`,
      RATE_LIMITS.ask.versuche,
      RATE_LIMITS.ask.fenster,
    ))) {
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
    // Wie in /api/ai/assist das Konto mit ins Log — ohne die Frage
    // selbst, die gehoert der Person. Sonst bliebe bei einer Haeufung
    // offen, ob ein einzelnes Konto oder der Anbieter klemmt.
    log.error({ err: e, userId: user.id }, "askWiki fehlgeschlagen");
    return { error: "KI-Anfrage fehlgeschlagen. Bitte später erneut." };
  }
}
