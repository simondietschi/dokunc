import { createServer, connect, type Socket } from "node:net";

/**
 * TCP-Weiche vor dem echten Redis, fuer Tests, in denen Redis beim Start
 * kurz fehlen soll. Geht auch in der CI, wo Redis ein Dienst-Container
 * ist und kein eigenes redis-server gestartet werden kann.
 */
export type Weiche = {
  /** REDIS_URL fuer den Pruefling: Weiche statt Redis. */
  url: string;
  /** Zurueckgesetzte Verbindungsversuche, solange die Weiche zu war. */
  abgewiesen(): number;
  schliessen(): Promise<void>;
};

/**
 * Zu Beginn setzt die Weiche jede Verbindung sofort zurueck (fuer ioredis
 * wie ein nicht erreichbares Redis), ab `offenNachMs` nach dem ersten
 * Versuch reicht sie zu `redisUrl` durch.
 */
export async function starteWeiche(
  redisUrl: string,
  offenNachMs: number,
): Promise<Weiche> {
  const ziel = new URL(redisUrl);
  let offen = false;
  let abgewiesen = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sockets = new Set<Socket>();
  const merke = (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };
  const server = createServer((client) => {
    merke(client);
    client.on("error", () => undefined);
    timer ??= setTimeout(() => {
      offen = true;
    }, offenNachMs);
    if (!offen) {
      abgewiesen += 1;
      client.resetAndDestroy();
      return;
    }
    const redis = connect(Number(ziel.port || 6379), ziel.hostname);
    merke(redis);
    redis.on("error", () => client.destroy());
    client.on("close", () => redis.destroy());
    redis.on("close", () => client.destroy());
    client.pipe(redis).pipe(client);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const adresse = server.address();
  if (!adresse || typeof adresse === "string") {
    throw new Error("Weiche ohne Port");
  }
  const url = new URL(redisUrl);
  url.hostname = "127.0.0.1";
  url.port = String(adresse.port);
  return {
    url: url.toString(),
    abgewiesen: () => abgewiesen,
    schliessen: async () => {
      clearTimeout(timer);
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
