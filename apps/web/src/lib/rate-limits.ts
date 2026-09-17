/**
 * Alle Bremsen der Anwendung an einer Stelle.
 *
 * Sie standen als nackte Zahlenpaare im Aufruf: `rateLimit(key, 20, 3600)`.
 * Zwei Probleme daran. Erstens sagt das Paar nicht, welche Haelfte die
 * Versuche und welche das Fenster ist — `(5, 900)` und `(10, 900)` stehen
 * in derselben Datei untereinander. Zweitens kam dasselbe Paar (20, 3600)
 * zweimal vor, fuer die KI-Frage und fuer Einladungen, also fuer voellig
 * Verschiedenes: Kosten beim Anbieter gegen Mailversand. Wer eine davon
 * aendern wollte, musste erst herausfinden, welche er vor sich hat.
 *
 * Hier steht jede Bremse einmal, mit dem Grund daneben. Der Nebeneffekt
 * ist die eigentliche Absicht: die gesamte Politik ist auf einem
 * Bildschirm zu lesen und zu vergleichen, statt ueber neun Routen und
 * vier Server-Actions verteilt.
 *
 * `fenster` ist immer in Sekunden.
 */

export type Bremse = { versuche: number; fenster: number };

export const RATE_LIMITS = {
  /** KI-Frage ueber den ganzen Bestand: begrenzt die Kosten beim Anbieter. */
  ask: { versuche: 20, fenster: 3600 },
  /** Textbefehle im Editor: dieselbe Kostenfrage, aber kleinere Antworten. */
  aiAssist: { versuche: 30, fenster: 3600 },

  /** Einladung in einen Space: begrenzt den Mailversand je Konto. */
  invite: { versuche: 20, fenster: 3600 },

  /**
   * Passwort zuruecksetzen, pro IP. Getrennt, weil die beiden Schritte
   * Verschiedenes kosten: das Anfordern verschickt eine Mail, das
   * Einloesen raet an einem Token.
   */
  resetRequest: { versuche: 5, fenster: 900 },
  resetSubmit: { versuche: 10, fenster: 900 },

  /** Anmeldung ueber einen fremden Anbieter, pro IP. */
  oidcStart: { versuche: 20, fenster: 300 },

  /**
   * Collab-Ticket: eines je Verbindungsaufbau. Grosszuegig, weil ein
   * wackliges Netz den Editor sonst aussperrt.
   */
  collabTicket: { versuche: 120, fenster: 60 },
  /** Suche: laeuft beim Tippen, deshalb dieselbe Groessenordnung. */
  search: { versuche: 120, fenster: 60 },
  /** Vorschlaege in der Palette: feuert noch dichter als die Suche. */
  suggest: { versuche: 240, fenster: 60 },

  /** Upload, pro IP: begrenzt, wie schnell die Platte vollaeuft. */
  upload: { versuche: 30, fenster: 60 },
  /** Import: jeder Lauf kann bis zu 2000 Seiten anlegen. */
  import: { versuche: 5, fenster: 600 },
  /** PDF-Export: jeder Lauf startet einen Browser. */
  exportPdf: { versuche: 10, fenster: 600 },
  /** Offene Benachrichtigungsstroeme je Konto. */
  notifyStream: { versuche: 30, fenster: 60 },

  /**
   * Anmeldung. Zwei Bremsen nebeneinander, und beide werden gebraucht:
   * die pro Konto (streng) gegen das Raten eines Passworts, die pro IP
   * (grosszuegiger) gegen das breite Durchprobieren vieler Konten — hinter
   * einem Firmenanschluss teilen sich viele Menschen eine Adresse.
   *
   * Bewusst ein ablaufendes Fenster und keine harte Sperre: eine echte
   * Sperre liesse sich missbrauchen, um fremde Konten gezielt
   * auszusperren. Gezaehlt wird jeder Versuch, aber ein erfolgreicher
   * Login raeumt den Zaehler sofort — sonst sperrte sich aus, wer sich an
   * mehreren Geraeten anmeldet.
   */
  login: { versuche: 8, fenster: 900 },
  loginIp: { versuche: 30, fenster: 300 },
  /** Registrierung pro IP. */
  register: { versuche: 10, fenster: 600 },
  /** Zweiter Faktor: Bestaetigen, Abschalten, Codes neu ausgeben. */
  totpConfirm: { versuche: 10, fenster: 600 },
} as const satisfies Record<string, Bremse>;
