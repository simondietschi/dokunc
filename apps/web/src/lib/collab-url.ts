/**
 * Adresse des Collab-WebSockets.
 *
 * `NEXT_PUBLIC_COLLAB_URL` wird beim Build in das Bundle eingesetzt —
 * ein fest eingebackener Wert würde das Image an eine Domain binden
 * (das Docker-Image liefe dann nur unter „localhost"). Ist die Variable
 * leer, wird die Adresse deshalb pro Request aus dem aufgerufenen Host
 * abgeleitet: derselbe Host, Pfad `/collab` — genau dorthin routet der
 * Reverse-Proxy den Hocuspocus-Server.
 *
 * Der Host-Header ist hier unkritisch: Der Browser verbindet sich damit
 * zurück zu der Adresse, auf der er ohnehin schon ist.
 */
export function resolveCollabUrl(opts: {
  configured?: string | null;
  host?: string | null;
  proto?: string | null;
  fallback?: string;
}): string {
  const configured = opts.configured?.trim();
  if (configured) return configured;

  const host = opts.host?.trim();
  if (!host) return opts.fallback ?? "ws://localhost:3001";

  // Bei mehreren Proxys steht links das ursprüngliche Schema.
  const proto = opts.proto?.split(",")[0]?.trim().toLowerCase();
  const scheme = proto === "https" || proto === "wss" ? "wss" : "ws";
  return `${scheme}://${host}/collab`;
}
