/**
 * Angekündigte Körpergrösse einer Anfrage.
 *
 * Gebraucht von jeder Route, die danach `req.formData()` aufruft: dieser
 * Aufruf liest den KOMPLETTEN Körper in den Speicher, bevor irgendeine
 * Grössenprüfung greift. Die Vorprüfung am Header ist also die einzige,
 * die den Prozess noch schützt.
 *
 * Eine blosse Zahl reicht dafür nicht. `Number(null ?? 0)` ergibt 0 und
 * `Number("abc")` ergibt NaN; mit beiden ist `declared > limit` falsch,
 * die Prüfung läuft ins Leere und eine Anfrage ohne Content-Length (oder
 * mit unsinnigem Wert) strömt ungebremst in den Speicher. Deshalb drei
 * Ergebnisse statt einer Zahl: der Fall "unbekannt" muss den Aufrufer
 * erreichen, damit er ihn ablehnen kann.
 */
export type DeclaredBodySize =
  | { kind: "ok"; bytes: number }
  | { kind: "zu-gross"; bytes: number }
  | { kind: "unbekannt" };

export function declaredBodySize(
  header: string | null | undefined,
  maxBytes: number,
): DeclaredBodySize {
  if (typeof header !== "string") return { kind: "unbekannt" };
  const raw = header.trim();
  // Nur reine Ziffern: "12.5", "1e3", "+7" und " 12, 12" (doppelter
  // Header) sind keine gültige Längenangabe, und Number() würde sie
  // teils klaglos umwandeln.
  if (!/^\d+$/.test(raw)) return { kind: "unbekannt" };
  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes)) return { kind: "unbekannt" };
  return bytes > maxBytes ? { kind: "zu-gross", bytes } : { kind: "ok", bytes };
}
