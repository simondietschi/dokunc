/**
 * Mitgelieferte Standardvorlagen als ProseMirror-JSON. Verwenden nur
 * Knoten des geteilten Editor-Schemas (heading, paragraph, Listen,
 * Aufgabenliste, Tabelle, Callout, codeBlock, horizontalRule), damit
 * sie in Editor, Export und Collab-Seeding identisch funktionieren.
 */

export type BuiltinTemplate = {
  /** Stabiler Schlüssel (kommt aus dem Formular). */
  key: string;
  title: string;
  /** Einzeiler für Picker und Verwaltungsseite. */
  description: string;
  content: Record<string, unknown>;
};

type Inline = { type: string; text?: string; marks?: { type: string }[] };
type Block = Record<string, unknown>;

const text = (t: string): Inline => ({ type: "text", text: t });
const bold = (t: string): Inline => ({
  type: "text",
  text: t,
  marks: [{ type: "bold" }],
});
/** Absatz aus Text oder Inline-Knoten (leerer String = leerer Absatz). */
function p(...parts: (string | Inline)[]): Block {
  const content = parts
    .map((x) => (typeof x === "string" ? text(x) : x))
    .filter((x) => x.type !== "text" || (x.text ?? "").length > 0);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}
const h = (level: 1 | 2 | 3, t: string): Block => ({
  type: "heading",
  attrs: { level },
  content: [text(t)],
});
const li = (...blocks: Block[]): Block => ({ type: "listItem", content: blocks });
const ul = (...items: string[]): Block => ({
  type: "bulletList",
  content: items.map((t) => li(p(t))),
});
const ol = (...items: string[]): Block => ({
  type: "orderedList",
  content: items.map((t) => li(p(t))),
});
const tasks = (...items: string[]): Block => ({
  type: "taskList",
  content: items.map((t) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [p(t)],
  })),
});
function cell(type: "tableHeader" | "tableCell", t: string): Block {
  return { type, content: [p(t)] };
}
function table(header: string[], rows: string[][]): Block {
  return {
    type: "table",
    content: [
      { type: "tableRow", content: header.map((c) => cell("tableHeader", c)) },
      ...rows.map((r) => ({
        type: "tableRow",
        content: r.map((c) => cell("tableCell", c)),
      })),
    ],
  };
}
const callout = (
  type: "info" | "success" | "warn" | "danger",
  ...blocks: Block[]
): Block => ({ type: "callout", attrs: { type }, content: blocks });
const code = (t: string, language = "bash"): Block => ({
  type: "codeBlock",
  attrs: { language },
  content: [text(t)],
});
const hr = (): Block => ({ type: "horizontalRule" });
const doc = (...blocks: Block[]): Record<string, unknown> => ({
  type: "doc",
  content: blocks,
});

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    key: "meeting",
    title: "Meeting-Notizen",
    description:
      "Teilnehmende, Agenda, Entscheidungen und Aufgaben eines Termins.",
    content: doc(
      p(bold("Datum: "), "…", text("   "), bold("Ort / Link: "), "…"),
      h(2, "Teilnehmende"),
      ul("Name (Rolle)", "Name (Rolle)"),
      h(2, "Agenda"),
      ol(
        "Rückblick auf die offenen Punkte vom letzten Termin",
        "Thema 1 – Ziel des Punkts in einem Satz",
        "Thema 2 – Ziel des Punkts in einem Satz",
        "Verschiedenes",
      ),
      h(2, "Notizen"),
      p(
        "Wichtigste Aussagen und Ergebnisse je Agendapunkt – kurz, damit auch Personen ohne Teilnahme folgen können.",
      ),
      h(2, "Entscheidungen"),
      ul("Entscheidung – Begründung – wer hat entschieden"),
      h(2, "Aufgaben"),
      tasks(
        "Aufgabe – Verantwortlich – bis wann",
        "Aufgabe – Verantwortlich – bis wann",
      ),
      callout(
        "info",
        p(
          "Tipp: Aufgaben direkt im Termin verteilen und Personen mit @ erwähnen – sie erhalten eine Benachrichtigung.",
        ),
      ),
    ),
  },
  {
    key: "adr",
    title: "Entscheidung (ADR)",
    description:
      "Architecture Decision Record: Kontext, Optionen, Entscheidung, Konsequenzen.",
    content: doc(
      callout(
        "info",
        p(bold("Status: "), "Vorgeschlagen"),
        p(bold("Datum: "), "…"),
        p(bold("Beteiligte: "), "…"),
      ),
      h(2, "Kontext"),
      p(
        "Welches Problem soll gelöst werden? Welche Rahmenbedingungen (Technik, Team, Zeit, Kosten) gelten? Was passiert, wenn nichts entschieden wird?",
      ),
      h(2, "Optionen"),
      table(
        ["Option", "Vorteile", "Nachteile", "Aufwand"],
        [
          ["Option A", "…", "…", "gering / mittel / hoch"],
          ["Option B", "…", "…", "gering / mittel / hoch"],
          ["Option C", "…", "…", "gering / mittel / hoch"],
        ],
      ),
      h(2, "Entscheidung"),
      p(
        "Wir wählen Option …, weil … Die wichtigsten Argumente gegen die Alternativen sind …",
      ),
      h(2, "Konsequenzen"),
      ul(
        "Positiv: was wird einfacher oder besser",
        "Negativ: welche Nachteile nehmen wir bewusst in Kauf",
        "Folgeaufgaben: was muss umgesetzt oder angepasst werden",
      ),
      hr(),
      p(
        "Diese Entscheidung wird überprüft, wenn sich die Rahmenbedingungen wesentlich ändern.",
      ),
    ),
  },
  {
    key: "runbook",
    title: "Runbook",
    description:
      "Schritt-für-Schritt-Anleitung für einen wiederkehrenden Betriebsvorgang.",
    content: doc(
      callout(
        "warn",
        p(
          "Vor der Ausführung: Voraussetzungen prüfen und den Rollback-Abschnitt lesen. Bei Unsicherheit die Kontakte unten einbeziehen.",
        ),
      ),
      h(2, "Zweck"),
      p(
        "Wofür dient dieser Vorgang, wann wird er ausgeführt und welche Systeme sind betroffen?",
      ),
      h(2, "Voraussetzungen"),
      ul(
        "Zugriff auf … (Rolle / Berechtigung)",
        "Benötigte Werkzeuge und Versionen",
        "Wartungsfenster bzw. Information der betroffenen Personen",
      ),
      h(2, "Schritte"),
      ol(
        "Ausgangszustand prüfen und dokumentieren",
        "Änderung durchführen",
        "Ergebnis verifizieren (Logs, Health-Check, Stichprobe)",
        "Beteiligte informieren und Ticket aktualisieren",
      ),
      p("Beispiel für einen Prüfbefehl:"),
      code("curl -fsS https://example.internal/api/health"),
      h(2, "Rollback"),
      ol(
        "Symptome, die einen Rollback erfordern",
        "Schritte, um den vorherigen Zustand wiederherzustellen",
        "Verifikation nach dem Rollback",
      ),
      h(2, "Kontakte"),
      table(
        ["Rolle", "Person", "Erreichbarkeit"],
        [
          ["Verantwortlich (Owner)", "…", "…"],
          ["Bereitschaft", "…", "…"],
          ["Eskalation", "…", "…"],
        ],
      ),
    ),
  },
  {
    key: "project-brief",
    title: "Projektbrief",
    description:
      "Ziel, Nicht-Ziele, Erfolgskriterien, Meilensteine und Risiken eines Vorhabens.",
    content: doc(
      p(
        bold("Projektleitung: "),
        "…",
        text("   "),
        bold("Start: "),
        "…",
        text("   "),
        bold("Geplantes Ende: "),
        "…",
      ),
      h(2, "Ziel"),
      p(
        "Was soll am Ende erreicht sein – in ein bis zwei Sätzen, so dass es für alle Beteiligten verständlich ist?",
      ),
      h(2, "Nicht-Ziele"),
      ul(
        "Was bewusst nicht Teil dieses Projekts ist",
        "Was später oder in einem anderen Vorhaben behandelt wird",
      ),
      h(2, "Erfolgskriterien"),
      ul(
        "Messbares Kriterium 1 (Zahl, Termin oder Zustand)",
        "Messbares Kriterium 2",
      ),
      h(2, "Meilensteine"),
      table(
        ["Meilenstein", "Termin", "Verantwortlich", "Status"],
        [
          ["Kick-off", "…", "…", "offen"],
          ["Erster Prototyp", "…", "…", "offen"],
          ["Abschluss", "…", "…", "offen"],
        ],
      ),
      h(2, "Risiken"),
      table(
        ["Risiko", "Wahrscheinlichkeit", "Auswirkung", "Massnahme"],
        [
          ["…", "niedrig / mittel / hoch", "niedrig / mittel / hoch", "…"],
          ["…", "niedrig / mittel / hoch", "niedrig / mittel / hoch", "…"],
        ],
      ),
      h(2, "Beteiligte"),
      ul("Auftraggeberin / Auftraggeber", "Projektteam", "Betroffene Teams"),
    ),
  },
  {
    key: "weekly",
    title: "Wochenbericht",
    description: "Highlights, Blocker und Plan für die nächste Woche.",
    content: doc(
      p(bold("Kalenderwoche: "), "…", text("   "), bold("Team: "), "…"),
      h(2, "Highlights"),
      ul(
        "Was wurde erreicht oder abgeschlossen",
        "Was lief besonders gut",
      ),
      h(2, "Blocker"),
      ul("Was bremst – und welche Unterstützung nötig ist"),
      h(2, "Nächste Woche"),
      tasks("Geplantes Thema 1", "Geplantes Thema 2"),
      callout(
        "success",
        p(
          "Kurz halten: drei bis fünf Punkte je Abschnitt reichen. Details gehören auf die jeweiligen Projektseiten.",
        ),
      ),
    ),
  },
];

/** Standardvorlage per Schlüssel (null bei unbekanntem Schlüssel). */
export function getBuiltinTemplate(key: string): BuiltinTemplate | null {
  return BUILTIN_TEMPLATES.find((t) => t.key === key) ?? null;
}
