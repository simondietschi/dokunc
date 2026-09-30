import { afterAll, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { NOTIFY_CHANNEL_PREFIX } from "@dokunc/editor";
import { starteWeiche, type Weiche } from "./redis-weiche";

/**
 * Redis fehlt, waehrend eine Person ihren Benachrichtigungsstrom oeffnet.
 *
 * Der Abonnent in lib/notify-bus.ts hat zwei Versuche je Befehl. Schickte
 * er sein SUBSCRIBE nur einmal beim Anlegen, lehnte ioredis es nach drei
 * gescheiterten Verbindungsversuchen ab (gut 150 ms), und nach dem
 * Wiederaufbau abonnierte ioredis nichts neu: das tut es nur fuer Kanaele,
 * die Redis schon bestaetigt hatte. Der Strom blieb offen und stumm, bis
 * der Browser ihn neu aufbaute. Deshalb abonniert notify-bus nach jedem
 * "ready".
 *
 * Der Abonnent spricht Redis ueber eine Weiche an (./redis-weiche), die
 * jede Verbindung 1,5 s lang sofort zuruecksetzt und dann durchreicht.
 * Gesendet wird direkt am echten Redis; Pub/Sub gilt ueber alle
 * Datenbanken, der Kanal ist je Lauf eindeutig.
 */

const AUSFALL_MS = 1_500;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const { subscribeNotifications } = await import("@/lib/notify-bus");

const userId = `nbst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let weiche: Weiche | null = null;
let abo: { close: () => void } | null = null;
const sender = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });

afterAll(async () => {
  abo?.close();
  await weiche?.schliessen();
  sender.disconnect();
  vi.unstubAllEnvs();
});

describe("Benachrichtigungsstrom oeffnet ohne Redis", () => {
  it("empfaengt, sobald Redis erreichbar ist", async () => {
    weiche = await starteWeiche(REDIS_URL, AUSFALL_MS);
    let empfangen = 0;
    // createRedis liest REDIS_URL beim Aufruf.
    vi.stubEnv("REDIS_URL", weiche.url);
    abo = subscribeNotifications(userId, () => {
      empfangen += 1;
    });
    vi.unstubAllEnvs();
    expect(abo).not.toBeNull();

    // Senden, bis etwas ankommt; wann das Abonnement steht, sieht der
    // Test von aussen nicht.
    const ende = Date.now() + AUSFALL_MS + 8_000;
    while (empfangen === 0 && Date.now() < ende) {
      await sender.publish(`${NOTIFY_CHANNEL_PREFIX}${userId}`, "1");
      await new Promise((r) => setTimeout(r, 100));
    }

    // Der Ausfall hat das Abonnieren wirklich getroffen: mehr abgewiesene
    // Versuche, als ein Befehl mit zwei Versuchen uebersteht.
    expect(weiche.abgewiesen()).toBeGreaterThanOrEqual(3);
    expect(empfangen).toBeGreaterThan(0);
  }, 20_000);
});
