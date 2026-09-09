/**
 * Kuratierte Emoji-Auswahl für Seitensymbole.
 *
 * Bewusst eine Liste im Code statt einer Bibliothek: der komplette
 * Unicode-Satz mit Suchindex wiegt mehr als der gesamte Editor, und für
 * ein Seitensymbol reicht eine gute Auswahl mit deutschen Stichworten.
 */
export type Emoji = { char: string; keywords: string };

export const EMOJI: Emoji[] = [
  { char: "📄", keywords: "seite dokument datei text" },
  { char: "📝", keywords: "notiz schreiben entwurf" },
  { char: "📘", keywords: "buch handbuch anleitung" },
  { char: "📚", keywords: "bücher wissen bibliothek" },
  { char: "📂", keywords: "ordner sammlung" },
  { char: "🗂️", keywords: "register ablage struktur" },
  { char: "📋", keywords: "liste klemmbrett aufgaben" },
  { char: "✅", keywords: "erledigt haken fertig" },
  { char: "☑️", keywords: "auswahl kasten erledigt" },
  { char: "📌", keywords: "pinnen wichtig merken" },
  { char: "📎", keywords: "anhang büroklammer" },
  { char: "🔖", keywords: "lesezeichen markierung" },
  { char: "🏷️", keywords: "etikett tag schild" },
  { char: "🔍", keywords: "suche lupe finden" },
  { char: "💡", keywords: "idee einfall glühbirne" },
  { char: "⚡", keywords: "schnell blitz energie" },
  { char: "🔥", keywords: "dringend heiss feuer" },
  { char: "⭐", keywords: "stern favorit wichtig" },
  { char: "❗", keywords: "achtung wichtig ausrufezeichen" },
  { char: "⚠️", keywords: "warnung achtung gefahr" },
  { char: "🚧", keywords: "baustelle in arbeit" },
  { char: "🛑", keywords: "stopp halt verboten" },
  { char: "🔒", keywords: "gesperrt sicher schloss" },
  { char: "🔑", keywords: "schlüssel zugang passwort" },
  { char: "🛡️", keywords: "sicherheit schutz schild" },
  { char: "🧭", keywords: "kompass orientierung leitfaden" },
  { char: "🗺️", keywords: "karte plan übersicht roadmap" },
  { char: "🎯", keywords: "ziel fokus zielscheibe" },
  { char: "🚀", keywords: "start rakete launch release" },
  { char: "🛠️", keywords: "werkzeug technik wartung" },
  { char: "⚙️", keywords: "einstellung zahnrad konfiguration" },
  { char: "🧪", keywords: "test versuch labor" },
  { char: "🐛", keywords: "fehler bug käfer" },
  { char: "💻", keywords: "code entwicklung rechner" },
  { char: "🖥️", keywords: "server rechner system" },
  { char: "📦", keywords: "paket auslieferung modul" },
  { char: "🗄️", keywords: "datenbank archiv schrank" },
  { char: "🌐", keywords: "web netzwerk internet" },
  { char: "🔗", keywords: "link verweis kette" },
  { char: "📡", keywords: "verbindung übertragung antenne" },
  { char: "📊", keywords: "diagramm auswertung statistik" },
  { char: "📈", keywords: "wachstum zahlen aufwärts" },
  { char: "📉", keywords: "rückgang zahlen abwärts" },
  { char: "🧮", keywords: "rechnen zahlen kalkulation" },
  { char: "💰", keywords: "budget geld kosten" },
  { char: "🧾", keywords: "rechnung beleg abrechnung" },
  { char: "📅", keywords: "termin kalender datum" },
  { char: "⏱️", keywords: "zeit dauer stoppuhr" },
  { char: "🕒", keywords: "uhr zeit stunde" },
  { char: "🔔", keywords: "benachrichtigung glocke hinweis" },
  { char: "📣", keywords: "ankündigung megafon news" },
  { char: "💬", keywords: "kommentar gespräch chat" },
  { char: "🗣️", keywords: "besprechung reden meeting" },
  { char: "🤝", keywords: "zusammenarbeit vereinbarung partner" },
  { char: "👥", keywords: "team gruppe personen" },
  { char: "👤", keywords: "person profil nutzer" },
  { char: "🎓", keywords: "lernen schulung ausbildung" },
  { char: "🧠", keywords: "wissen denken konzept" },
  { char: "❓", keywords: "frage unklar hilfe" },
  { char: "ℹ️", keywords: "info hinweis" },
  { char: "🏠", keywords: "start zuhause übersicht" },
  { char: "🏢", keywords: "firma büro organisation" },
  { char: "🌱", keywords: "neu wachstum entwurf" },
  { char: "🎉", keywords: "erfolg feier meilenstein" },
  { char: "🏆", keywords: "erfolg gewinn auszeichnung" },
  { char: "🧩", keywords: "baustein modul puzzle" },
  { char: "🪄", keywords: "automatisch magie zauber" },
  { char: "🤖", keywords: "ki bot automatisierung" },
  { char: "☁️", keywords: "cloud wolke hosting" },
  { char: "🔄", keywords: "ablauf prozess kreislauf" },
  { char: "📮", keywords: "eingang post anfrage" },
  { char: "✉️", keywords: "mail nachricht brief" },
  { char: "🗒️", keywords: "notizblock protokoll" },
  { char: "🖊️", keywords: "stift schreiben unterschrift" },
  { char: "🧹", keywords: "aufräumen bereinigung putzen" },
  { char: "🗑️", keywords: "papierkorb löschen müll" },
];

/** Filtert die Auswahl nach einem Suchbegriff. */
export function searchEmoji(query: string): Emoji[] {
  const q = query.trim().toLowerCase();
  if (!q) return EMOJI;
  return EMOJI.filter(
    (e) => e.keywords.includes(q) || e.char === q,
  );
}
