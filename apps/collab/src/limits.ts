/**
 * Grenzen fuer Verbindungen zum Collab-Server.
 *
 * Vorher bekam der Server nur Port und Erweiterungen: beliebig viele
 * gleichzeitige Verbindungen, beliebig viele Versuche. Jede Verbindung
 * haelt einen Socket, und jede angemeldete zusaetzlich Speicher im
 * Dokument; jeder Versuch mit Ticket kostet mehrere Datenbankabfragen.
 * Ein einzelnes Konto (oder ein Skript mit dessen Sitzung) konnte so die
 * ganze Instanz belegen.
 *
 * Hier steht nur Logik ohne Hocuspocus, Redis oder Datenbank, damit sie
 * sich fuer sich pruefen laesst. Die Verdrahtung steht in server.ts.
 */

/** Fenster der Versuchsbremsen (s). */
export const ATTEMPT_WINDOW_SEC = 60;

/**
 * Frist, in der sich ein Socket anmelden muss (ms); danach schliesst ihn
 * der Collab-Server (siehe AuthDeadlines).
 *
 * Hocuspocus selbst schliesst einen nie angemeldeten Socket erst nach 60
 * bis 120 s: sein Timeout betraegt 60 s und wird im selben Takt geprueft.
 * So lange belegte jeder Socket ohne Ticket einen Platz der Instanz, und
 * wenige Adressen haetten sie fuellen koennen. Ein Editor braucht fuer
 * die Anmeldung einen Abruf bei der Web-App (Ticket) und ein paar
 * Datenbankabfragen hier, also in aller Regel unter einer Sekunde; 15 s
 * lassen einem langsamen Netz reichlich Luft.
 */
export const UNAUTHENTICATED_TIMEOUT_MS = 15_000;

export type ConnectionLimits = {
  /**
   * Offene Sockets dieser Instanz, angemeldet oder nicht. Gezaehlt wird
   * vor dem WebSocket-Handshake, also auch, wer nie ein Ticket schickt;
   * solche Sockets schliesst der Collab-Server nach
   * UNAUTHENTICATED_TIMEOUT_MS.
   */
  maxConnections: number;
  /**
   * Offene Sockets je Client-Adresse auf dieser Instanz, angemeldet oder
   * nicht. Ohne diese Grenze fuellten zwei Adressen die ganze Instanz,
   * denn die Versuchsbremse zaehlt nur neue Versuche, nicht offene
   * Sockets.
   */
  maxConnectionsPerIp: number;
  /** Gleichzeitige Dokument-Verbindungen einer Person auf dieser Instanz. */
  maxConnectionsPerUser: number;
  /** Verbindungsversuche je IP und Minute (vor dem Handshake). */
  maxAttemptsPerIp: number;
  /** Verbindungsversuche je Person und Minute (mit gueltigem Ticket). */
  maxAttemptsPerUser: number;
};

/**
 * Vorgaben, jede 0 schaltet die Grenze ab.
 *
 * - 1000 Sockets je Instanz: ein Richtwert fuer einen Prozess im
 *   mitgelieferten Container (Web-App und Collab-Server teilen sich dort
 *   2 GB und 1,5 CPU), nicht aus einer Messung abgeleitet. Jeder offene
 *   Socket haelt Puffer im Prozess, jede angemeldete Verbindung dazu ihr
 *   geladenes Dokument und Rechenzeit fuer dessen Abgleich. Das
 *   Dateideskriptor-Limit setzt die Grenze dagegen nicht: Node hebt beim
 *   Start das weiche Limit auf das harte an, und das liegt in Containern
 *   meist weit darueber. Nur wo das harte Limit selbst niedrig ist (zu
 *   sehen in /proc/<pid>/limits, "Max open files"), muss es fuer eine
 *   hoehere Grenze mit angehoben werden.
 * - 50 je Adresse: dieselbe Zahl wie je Person — ein Tab mit einer Seite
 *   ist eine Verbindung. Hinter einem Firmen-NAT teilen sich viele
 *   Menschen eine Adresse; dort muss die Grenze hoeher stehen. Hinter
 *   einem Reverse-Proxy zaehlt die Adresse aus X-Forwarded-For nur mit
 *   passendem TRUSTED_PROXY_HOPS, sonst teilen sich alle die Adresse des
 *   Proxys.
 * - 50 je Person: ein Tab mit einer Seite ist eine Verbindung. Nach dem
 *   Aufwachen eines Laptops zaehlen die alten, halb toten Sockets noch
 *   bis zu Hocuspocus' Timeout mit, waehrend die Tabs schon neu
 *   verbinden; 25 offene Seiten verdoppeln sich so kurzzeitig.
 * - 300 Versuche je IP und Minute: hinter einem Firmen-NAT teilen sich
 *   viele Menschen eine Adresse, und nach einem Neustart des
 *   Collab-Servers verbinden alle Tabs gleichzeitig neu. Wer abgewiesen
 *   wird, versucht es mit wachsendem Abstand erneut.
 * - 120 Versuche je Person und Minute: dieselbe Zahl wie die Ticket-Route
 *   (RATE_LIMITS.collabTicket). Jeder ehrliche Versuch braucht ein
 *   frisches Ticket, diese Bremse greift also erst, wenn Tickets anders
 *   als vorgesehen verwendet werden.
 */
export const DEFAULT_LIMITS: ConnectionLimits = {
  maxConnections: 1000,
  maxConnectionsPerIp: 50,
  maxConnectionsPerUser: 50,
  maxAttemptsPerIp: 300,
  maxAttemptsPerUser: 120,
};

const ENV_NAMES: Record<keyof ConnectionLimits, string> = {
  maxConnections: "COLLAB_MAX_CONNECTIONS",
  maxConnectionsPerIp: "COLLAB_MAX_CONNECTIONS_PER_IP",
  maxConnectionsPerUser: "COLLAB_MAX_CONNECTIONS_PER_USER",
  maxAttemptsPerIp: "COLLAB_MAX_ATTEMPTS_PER_IP",
  maxAttemptsPerUser: "COLLAB_MAX_ATTEMPTS_PER_USER",
};

/**
 * Grenzen aus der Umgebung lesen.
 *
 * Leer oder nicht gesetzt: Vorgabe. Unsinn (negativ, Komma, Text) ebenfalls
 * Vorgabe, aber mit Meldung — still auf die Vorgabe zu fallen hiesse,
 * dass eine vertippte Grenze unbemerkt nicht gilt; mit 0 oder "aus"
 * gleichzusetzen hiesse, dass ein Tippfehler den Schutz abschaltet.
 */
export function readConnectionLimits(
  env: Record<string, string | undefined>,
  warn: (detail: { variable: string; wert: string }, msg: string) => void,
): ConnectionLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(ENV_NAMES) as (keyof ConnectionLimits)[]) {
    const variable = ENV_NAMES[key];
    const raw = env[variable]?.trim();
    if (!raw) continue;
    if (/^\d+$/.test(raw)) {
      limits[key] = Number(raw);
    } else {
      warn(
        { variable, wert: raw.slice(0, 40) },
        "Ungueltige Verbindungsgrenze, Vorgabe gilt",
      );
    }
  }
  return limits;
}

/** Ergebnis von `SocketGate.tryAcquire`. */
export type Admission =
  | { ok: true; release: () => void }
  | { ok: false; grund: "instanz" | "adresse" };

/**
 * Zaehlt die offenen Sockets der Instanz, gesamt und je Client-Adresse.
 *
 * `tryAcquire` belegt einen Platz und gibt die Freigabe zurueck, oder den
 * Grund, warum kein Platz frei ist. Die Freigabe wirkt genau einmal: der
 * Aufrufer haengt sie an das Schliessen des Sockets, und ein doppeltes
 * Ereignis darf die Zaehler nicht unter die Wirklichkeit druecken —
 * sonst liesse die Grenze nach jedem solchen Fall eine Verbindung mehr
 * zu.
 */
export class SocketGate {
  private open = 0;
  private readonly perAddress = new Map<string, number>();

  constructor(
    private readonly max: number,
    private readonly maxPerAddress = 0,
  ) {}

  get size(): number {
    return this.open;
  }

  /** Offene Sockets einer Adresse. */
  sizeFor(address: string): number {
    return this.perAddress.get(address) ?? 0;
  }

  tryAcquire(address: string): Admission {
    if (this.max > 0 && this.open >= this.max) {
      return { ok: false, grund: "instanz" };
    }
    const fromAddress = this.sizeFor(address);
    if (this.maxPerAddress > 0 && fromAddress >= this.maxPerAddress) {
      return { ok: false, grund: "adresse" };
    }
    this.open += 1;
    this.perAddress.set(address, fromAddress + 1);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.open -= 1;
        const rest = this.sizeFor(address) - 1;
        // Leere Eintraege entfernen: sonst waechst die Tabelle mit jeder
        // Adresse, die je verbunden war.
        if (rest > 0) this.perAddress.set(address, rest);
        else this.perAddress.delete(address);
      },
    };
  }
}

/**
 * Anmeldefristen offener Sockets.
 *
 * `start` beginnt beim Upgrade die Frist eines Sockets, `settle` beendet
 * sie ohne Folgen (Anmeldung gelungen oder Socket zu). Laeuft sie ab,
 * ruft sie `expire` — der Aufrufer schliesst dann den Socket. Warum eine
 * eigene Frist: siehe UNAUTHENTICATED_TIMEOUT_MS.
 */
export class AuthDeadlines {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly timeoutMs: number) {}

  get size(): number {
    return this.pending.size;
  }

  start(id: string, expire: () => void): void {
    this.settle(id);
    const timer = setTimeout(() => {
      this.pending.delete(id);
      expire();
    }, this.timeoutMs);
    // Eine Frist allein haelt den Prozess nicht am Leben (Herunterfahren).
    timer.unref?.();
    this.pending.set(id, timer);
  }

  settle(id: string): void {
    const timer = this.pending.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pending.delete(id);
  }
}

/**
 * Gleichzeitige Verbindungen je Person.
 *
 * Die aufgebauten Verbindungen zaehlt der Aufrufer aus dem Zustand von
 * Hocuspocus (`established`), nicht diese Klasse: ein eigener Zaehler,
 * der bei jedem Trennen herunterzaehlt, liefe bei jedem verpassten
 * Ereignis davon, und die Person waere bis zum Neustart ausgesperrt.
 *
 * Was diese Klasse zaehlt, sind die Verbindungen dazwischen: das Ticket
 * ist geprueft, das Dokument aber noch nicht geladen, die Verbindung
 * also noch nirgends zu sehen. Ohne diese Vormerkung kaemen gleichzeitig
 * eintreffende Anmeldungen alle an derselben Zaehlung vorbei.
 *
 * Eine Vormerkung endet mit `settle` (Verbindung steht oder Anmeldung
 * gescheitert) oder spaetestens nach `holdMs`. Die Frist ist der
 * Rueckfall fuer Wege, auf denen Hocuspocus keinen Haken mehr ruft
 * (Laden des Dokuments gescheitert, Socket waehrend des Ladens zu).
 */
export class UserSlots {
  private readonly pending = new Map<
    string,
    { userId: string; expiresAt: number }
  >();

  constructor(
    private readonly max: number,
    private readonly holdMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Platz fuer eine weitere Verbindung vormerken. `key` bezeichnet die
   * Anmeldung (Socket und Dokument); eine zweite Anmeldung unter
   * demselben Schluessel ersetzt die erste.
   */
  tryReserve(key: string, userId: string, established: number): boolean {
    this.sweep();
    this.pending.delete(key);
    if (this.max > 0 && established + this.pendingFor(userId) >= this.max) {
      return false;
    }
    this.pending.set(key, { userId, expiresAt: this.now() + this.holdMs });
    return true;
  }

  settle(key: string): void {
    this.pending.delete(key);
  }

  pendingFor(userId: string): number {
    const now = this.now();
    let n = 0;
    for (const entry of this.pending.values()) {
      if (entry.userId === userId && entry.expiresAt > now) n += 1;
    }
    return n;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(key);
    }
  }
}

/**
 * Anzahl eigener Reverse-Proxys, wie in apps/web/src/lib/client-ip.ts:
 * fehlt die Angabe oder steht Unsinn darin, gilt 0. Ein angenommener
 * Proxy, den es nicht gibt, machte den vom Client frei geschriebenen
 * Header zur Adresse, und jeder erfundene Wert bekaeme eine frische
 * Bremse.
 */
export function trustedProxyHops(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** Klammern und Port entfernen, IPv4 in IPv6 auspacken. */
function normalizeIp(value: string): string | null {
  let ip = value.trim().toLowerCase();
  if (!ip) return null;
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];
  else if (ip.split(":").length - 1 === 1) ip = ip.split(":")[0];
  // Node meldet IPv4-Gegenstellen an einem IPv6-Socket als
  // ::ffff:1.2.3.4 — dieselbe Adresse soll denselben Zaehler treffen.
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7);
  return ip || null;
}

/**
 * Adresse, nach der die Versuchsbremse zaehlt.
 *
 * Ohne Proxy (hops 0) ist die Gegenstelle des Sockets der Client — anders
 * als in der Web-App, die unter Next.js keinen Socket sieht, laesst sich
 * das hier also verlaesslich bestimmen. Mit Proxys zaehlt der Eintrag,
 * den der aeusserste eigene Proxy in X-Forwarded-For geschrieben hat.
 * Fehlt er, faellt alles in einen gemeinsamen Topf: das bremst zu streng
 * statt gar nicht.
 */
export function clientAddress(
  forwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined,
  hops: number,
): string {
  if (hops <= 0) {
    return (remoteAddress && normalizeIp(remoteAddress)) || "unknown";
  }
  const header = Array.isArray(forwardedFor)
    ? forwardedFor.join(",")
    : forwardedFor;
  if (!header) return "unknown";
  const parts = header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < hops) return "unknown";
  return normalizeIp(parts[parts.length - hops]) ?? "unknown";
}
