import { Redis } from "ioredis";

/**
 * Die Redis-Verbindung des Collab-Servers. Alle weiteren entstehen per
 * duplicate() aus ihr und uebernehmen damit ihre Optionen.
 */

/**
 * Wartezeit vor dem n-ten Versuch, eine abgerissene Verbindung wieder
 * aufzubauen: je Versuch 50 ms mehr, hoechstens zwei Sekunden. Das war
 * die Vorgabe von ioredis 5; ioredis 6 verdoppelt stattdessen bis fuenf
 * Sekunden (plus Zufall).
 *
 * Der Abstand bestimmt auch, wie lange ein Befehl waehrend eines Ausfalls
 * haengt: ioredis lehnt wartende Befehle erst ab, wenn seit dem letzten
 * Ablehnen `maxRetriesPerRequest` + 1 Verbindungsversuche gescheitert
 * sind. Bei zwei Versuchen je Befehl waren das mit der Vorgabe von
 * ioredis 6 etwa 15 s, bevor Bremse und Ticketverbrauch (./redis-guards)
 * auf ihren Speicher im Prozess ausweichen konnten — waehrenddessen hing
 * jeder Verbindungsaufbau. Hier hoechstens 6 s.
 *
 * Dieselbe Rechnung steht in apps/web/src/lib/redis.ts.
 */
export function reconnectDelay(times: number): number {
  return Math.min(times * 50, 2000);
}

/**
 * Zwei Versuche je Befehl, dann nimmt der Aufrufer seinen Ausweg.
 * lazyConnect: verbunden wird beim ersten Befehl.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    retryStrategy: reconnectDelay,
  });
}
