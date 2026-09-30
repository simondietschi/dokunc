import type { MermaidConfig } from "mermaid";

/**
 * Optionen fuer `mermaid.initialize` in der Editor-Ansicht (MermaidView).
 *
 * Sicherheit: `securityLevel: "strict"` laesst mermaid Beschriftungen
 * und das fertige SVG mit DOMPurify saeubern und schaltet Klick-Aktionen
 * ab; die Ansicht setzt das SVG per innerHTML ein. mermaid fuehrt
 * `securityLevel` in `secure`, ein Diagramm kann es per Front Matter oder
 * Direktive also nicht lockern. Es steht trotzdem ausdruecklich da, damit
 * ein geaenderter Vorgabewert einer kuenftigen Version hier nichts
 * verschiebt. `startOnLoad: false`: mermaid soll nicht selbst das DOM nach
 * `.mermaid`-Elementen absuchen, gerendert wird nur ueber `render()`.
 *
 * Fehler: `suppressErrorRendering: true`. mermaid baut jedes Bild in
 * einem Hilfselement am Ende von <body> (`d` und die id des Laufs). Bei
 * einem Syntax- oder Zeichenfehler zeichnet es dort sonst sein Fehlerbild
 * ("Syntax error in text") und laesst das Element stehen; weg kommt es, wenn
 * ein Lauf mit derselben id beginnt. Seit MermaidView jedem Lauf eine
 * eigene id gibt, geschieht das nie, und jeder Fehler liess ein weiteres
 * Fehlerbild unter der App zurueck. Die Ansicht zeigt den Fehler selbst
 * (`.dk-mermaid-error`) und raeumt nach jedem Lauf auf. Der Schluessel
 * steht wie `securityLevel` in `secure`, ein Diagramm kann ihn per Front
 * Matter oder Direktive nicht abschalten.
 *
 * Darstellung: mermaid 12 hat die Vorgaben geaendert, bestehende
 * Diagramme saehen nach dem Update anders aus. Hier steht, was das Bild
 * von mermaid 11 haelt. Ein Diagramm kann jeden dieser Werte im Front
 * Matter wieder ueberschreiben (`config: layout: elk`, `look: neo`).
 * - `theme` folgt wie bisher dem Hell/Dunkel-Modus. Global gesetzt
 *   schlaegt es die neue Vorgabe `redux-color` der einzelnen Typen.
 * - `look: "classic"` statt der neuen Vorgabe `neo` (Flussdiagramm,
 *   Sequenz, Klasse, Zustand, ER, Requirement u. a.).
 * - `layout: "dagre"` statt ELK, und zwar je Diagrammtyp, nicht global:
 *   ein global gesetztes `layout` nimmt mermaid bei Mindmaps als
 *   ausdruecklichen Wunsch und setzte sie dann mit dagre statt wie bisher
 *   mit cose-bilkent. Die Liste enthaelt jeden Typ, dessen Renderer in
 *   mermaid 12.0.0 ohne eigene Angabe auf eine Vorgabe `elk` faellt
 *   (die globale oder, bei Zustandsdiagrammen, die ihres Abschnitts).
 *   Mindmap (cose-bilkent) und Swimlane (eigenes Layout) bringen
 *   ihre eigene mit, alle anderen (Sequenz, Gantt, C4, Block u. a.)
 *   waehlen gar kein Layout. Use-Case und Agentflow sind in 12 neu und
 *   haetten kein altes Bild zu halten, sie stehen trotzdem hier: ohne
 *   eigene Angabe luden sie den ELK-Chunk (1,4 MB roh). Ihre Renderer
 *   fallen ohne ELK selbst auf dagre zurueck (so auch im Tiny-Build von
 *   mermaid), brauchen es also nicht. Damit bleibt ELK Opt-in: geladen
 *   wird es nur, wenn ein Diagramm `layout: elk` im Front Matter oder
 *   einer Direktive verlangt. Das Schluesselwort `flowchart-elk` setzt
 *   sich gegen die Angabe hier nicht durch und bleibt bei dagre, wie
 *   schon unter mermaid 11, das ELK nicht mitbrachte. Unter dagre legt
 *   Agentflow, wie Flussdiagramm-Subgraphen, einen Container ohne Kanten
 *   nach aussen quer zur Diagrammrichtung; `direction TB` im Container
 *   oder `layout: elk` gibt das Bild aus der mermaid-Doku.
 * - `wrappingWidth: 200` und `minNodeWidth: 0`: mermaid 12 bricht
 *   Beschriftungen bei 120 px um und macht jeden Knoten mindestens 120 px
 *   breit; bis 11 waren es 200 px und keine Mindestbreite.
 */
export function mermaidConfig(dark: boolean): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: dark ? "dark" : "default",
    look: "classic",
    flowchart: { layout: "dagre", wrappingWidth: 200, minNodeWidth: 0 },
    state: { layout: "dagre", wrappingWidth: 200, minNodeWidth: 0 },
    class: { layout: "dagre" },
    er: { layout: "dagre" },
    requirement: { layout: "dagre" },
    usecase: { layout: "dagre" },
    agentflow: { layout: "dagre" },
  };
}
