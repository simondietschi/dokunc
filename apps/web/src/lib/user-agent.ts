/**
 * Kurzbeschreibung eines Geräts aus dem User-Agent.
 *
 * Bewusst grob und ohne Bibliothek: die Angabe hilft beim
 * Wiedererkennen der eigenen Geräte, sie ist kein Fingerabdruck.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua.trim()) return "Unbekanntes Gerät";

  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;

  const system =
    /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : null;

  if (browser && system) return `${browser} auf ${system}`;
  return browser ?? system ?? "Unbekanntes Gerät";
}
