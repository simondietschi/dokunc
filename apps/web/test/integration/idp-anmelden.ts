/**
 * Meldet ein Konto am Test-IdP an, ohne Browser.
 *
 * Faehrt die Entwicklungsmaske des IdP (devInteractions) per fetch mit
 * eigenem Cookie-Speicher durch: Autorisierungs-URL, Maske, Formular
 * mit Kontoname und beliebigem Passwort, dann die Weiterleitungen des
 * IdP. Zurueck kommt die Ruecksprung-URL mit `code` und `state`; sie
 * wird nicht aufgerufen, das tut der Test mit dem echten Anmeldeweg.
 */
export async function idpAnmelden(
  authorizationUrl: string,
  konto: string,
): Promise<URL> {
  const idp = new URL(authorizationUrl).origin;
  const kekse = new Map<string, string>();

  async function hole(url: URL, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        cookie: [...kekse].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      signal: AbortSignal.timeout(10_000),
    });
    for (const keks of res.headers.getSetCookie()) {
      const [paar] = keks.split(";");
      const i = paar.indexOf("=");
      kekse.set(paar.slice(0, i), paar.slice(i + 1));
    }
    return res;
  }

  function ziel(res: Response): URL {
    const location = res.headers.get("location");
    if (!location) {
      throw new Error(`Test-IdP: keine Weiterleitung (Status ${res.status})`);
    }
    return new URL(location, idp);
  }

  // Autorisierung: der IdP leitet zur Anmeldemaske.
  let res = await hole(new URL(authorizationUrl));
  res = await hole(ziel(res));
  const html = await res.text();
  const aktion = /action="([^"]+)"/.exec(html)?.[1];
  if (!aktion) throw new Error("Test-IdP: Anmeldemaske ohne Formular");

  res = await hole(new URL(aktion, idp), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ prompt: "login", login: konto, password: "egal" }),
  });
  // Weiterleitungen des IdP folgen, bis eine aus ihm hinausfuehrt.
  for (let i = 0; i < 10; i++) {
    if (res.status < 300 || res.status >= 400) break;
    const naechstes = ziel(res);
    if (naechstes.origin !== idp) return naechstes;
    res = await hole(naechstes);
  }
  throw new Error(
    `Test-IdP: kein Ruecksprung fuer "${konto}" (Status ${res.status})`,
  );
}
