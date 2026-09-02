/**
 * Eingebaute Seitenvorlagen (Startinhalt als TipTap-JSON). Ohne
 * Server-Imports, damit der Vorlagen-Picker (Client) die Metadaten
 * direkt nutzen kann. Space-eigene Vorlagen liegen in `PageTemplate`.
 */

export type TemplateMeta = {
  id: string;
  name: string;
  description: string;
  icon: string;
};

export type BuiltinTemplate = TemplateMeta & {
  /** Titel der neuen Seite (Datum wird bei `{date}` eingesetzt). */
  title: string;
  content: Record<string, unknown>;
};

export const BUILTIN_PREFIX = "builtin:";

type Node = Record<string, unknown>;

const text = (t: string, marks?: string[]): Node => ({
  type: "text",
  text: t,
  ...(marks ? { marks: marks.map((m) => ({ type: m })) } : {}),
});
// Leere Textknoten sind im ProseMirror-Schema verboten -> herausfiltern.
const p = (...content: Node[]): Node => {
  const kept = content.filter((n) => !(n.type === "text" && !n.text));
  return { type: "paragraph", ...(kept.length ? { content: kept } : {}) };
};
const h = (level: number, t: string): Node => ({
  type: "heading",
  attrs: { level },
  content: [text(t)],
});
const li = (...content: Node[]): Node => ({
  type: "listItem",
  content: [p(...content)],
});
const ul = (...items: string[]): Node => ({
  type: "bulletList",
  content: items.map((i) => li(text(i))),
});
const task = (...items: string[]): Node => ({
  type: "taskList",
  content: items.map((i) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [p(text(i))],
  })),
});
const callout = (type: string, t: string): Node => ({
  type: "callout",
  attrs: { type },
  content: [p(text(t))],
});
const cell = (t: string, header = false): Node => ({
  type: header ? "tableHeader" : "tableCell",
  content: [p(text(t))],
});
const table = (headers: string[], rows: string[][]): Node => ({
  type: "table",
  content: [
    { type: "tableRow", content: headers.map((c) => cell(c, true)) },
    ...rows.map((r) => ({ type: "tableRow", content: r.map((c) => cell(c)) })),
  ],
});
const doc = (...content: Node[]): Record<string, unknown> => ({
  type: "doc",
  content,
});

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "meeting",
    name: "Meeting-Notizen",
    description: "Agenda, Entscheidungen und Aufgaben eines Termins.",
    icon: "📅",
    title: "Meeting {date}",
    content: doc(
      table(
        ["Datum", "Teilnehmende", "Moderation"],
        [["{date}", "", ""]],
      ),
      h(2, "Agenda"),
      ul("Thema 1", "Thema 2", "Thema 3"),
      h(2, "Notizen"),
      p(),
      h(2, "Entscheidungen"),
      ul("…"),
      h(2, "Aufgaben"),
      task("Aufgabe – Verantwortlich – Fällig am"),
    ),
  },
  {
    id: "adr",
    name: "Entscheidungsprotokoll (ADR)",
    description: "Architektur- oder Produktentscheidung mit Kontext und Folgen.",
    icon: "⚖️",
    title: "ADR: Titel der Entscheidung",
    content: doc(
      table(
        ["Status", "Datum", "Entscheider"],
        [["Vorgeschlagen", "{date}", ""]],
      ),
      h(2, "Kontext"),
      p(text("Welche Situation oder welches Problem führt zu dieser Entscheidung?")),
      h(2, "Optionen"),
      ul("Option A – Vorteile / Nachteile", "Option B – Vorteile / Nachteile"),
      h(2, "Entscheidung"),
      callout("info", "Wir entscheiden uns für …, weil …"),
      h(2, "Konsequenzen"),
      ul("Positiv: …", "Negativ: …", "Offene Punkte: …"),
    ),
  },
  {
    id: "onboarding",
    name: "Onboarding",
    description: "Checkliste und Wegweiser für neue Teammitglieder.",
    icon: "🚀",
    title: "Onboarding",
    content: doc(
      callout("success", "Willkommen im Team! Diese Seite führt dich durch die ersten Wochen."),
      h(2, "Erste Woche"),
      task(
        "Zugänge einrichten (Mail, Chat, Repos)",
        "Team kennenlernen",
        "Entwicklungsumgebung aufsetzen",
        "Erste kleine Aufgabe übernehmen",
      ),
      h(2, "Wichtige Seiten"),
      ul("Architektur-Übersicht", "Arbeitsweise & Rituale", "Wer ist wofür zuständig"),
      h(2, "Ansprechpersonen"),
      table(["Thema", "Person"], [["Buddy", ""], ["Technik", ""], ["Organisation", ""]]),
    ),
  },
  {
    id: "postmortem",
    name: "Postmortem",
    description: "Vorfall ohne Schuldzuweisung analysieren und Massnahmen ableiten.",
    icon: "🔥",
    title: "Postmortem: Vorfall vom {date}",
    content: doc(
      table(
        ["Datum", "Dauer", "Auswirkung", "Schweregrad"],
        [["{date}", "", "", ""]],
      ),
      h(2, "Zusammenfassung"),
      p(text("Was ist passiert, in zwei bis drei Sätzen.")),
      h(2, "Zeitachse"),
      ul("hh:mm – Erste Meldung", "hh:mm – Ursache erkannt", "hh:mm – Behoben"),
      h(2, "Ursache"),
      p(),
      h(2, "Was gut lief / was nicht"),
      ul("Gut: …", "Verbesserungswürdig: …"),
      h(2, "Massnahmen"),
      task("Massnahme – Verantwortlich – Fällig am"),
      callout("warn", "Blameless: Es geht um Systeme und Prozesse, nicht um Personen."),
    ),
  },
  {
    id: "howto",
    name: "Anleitung (How-to)",
    description: "Schritt-für-Schritt-Anleitung mit Voraussetzungen und Fehlerbehebung.",
    icon: "🛠️",
    title: "Anleitung: …",
    content: doc(
      callout("info", "Ziel dieser Anleitung in einem Satz."),
      h(2, "Voraussetzungen"),
      ul("…"),
      h(2, "Schritte"),
      { type: "orderedList", content: ["Schritt 1", "Schritt 2", "Schritt 3"].map((s) => li(text(s))) },
      h(2, "Prüfen"),
      p(text("Woran erkennt man, dass es funktioniert hat?")),
      h(2, "Fehlerbehebung"),
      table(["Problem", "Lösung"], [["", ""]]),
    ),
  },
];

/** Metadaten der eingebauten Vorlagen (für den Picker). */
export const BUILTIN_TEMPLATE_META: TemplateMeta[] = BUILTIN_TEMPLATES.map(
  ({ id, name, description, icon }) => ({
    id: BUILTIN_PREFIX + id,
    name,
    description,
    icon,
  }),
);

export function findBuiltinTemplate(id: string): BuiltinTemplate | null {
  if (!id.startsWith(BUILTIN_PREFIX)) return null;
  const key = id.slice(BUILTIN_PREFIX.length);
  return BUILTIN_TEMPLATES.find((t) => t.id === key) ?? null;
}

/** Ersetzt `{date}` (Titel + Inhalt) durch das heutige Datum. */
export function fillTemplate<T>(value: T, date = new Date()): T {
  const d = date.toLocaleDateString("de-CH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return JSON.parse(JSON.stringify(value).replace(/\{date\}/g, d)) as T;
}
