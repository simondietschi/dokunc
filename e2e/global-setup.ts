import path from "node:path";
import { Client } from "pg";
import { Redis } from "ioredis";
import { config as loadEnv } from "dotenv";

/**
 * Datenbank-Hosts, gegen die der Lauf ohne Rückfrage leeren darf.
 * Alles hier ist entweder der eigene Rechner oder ein Dienstname aus
 * einem Container-Netz — beides nicht von aussen erreichbar und damit
 * kein produktiver Server. Leerer Host = Unix-Socket, also ebenfalls
 * lokal.
 */
const LOKALE_DB_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1", "db"]);

/**
 * Bricht ab, bevor eine fremde Datenbank geleert wird.
 *
 * globalSetup lädt die Root-.env und führt danach TRUNCATE über alle
 * Tabellen aus. Ohne diese Prüfung genügt eine .env, die auf eine echte
 * Instanz zeigt (Betreiber-Laptop mit der Produktions-URL, kopierte
 * .env), und ein `pnpm test:e2e` löscht deren gesamten Inhalt — ohne
 * Rückfrage und ohne dass die bisherige Prüfung "DATABASE_URL gesetzt"
 * etwas merkt. Die Warnung stand bisher nur im README.
 *
 * Wer bewusst gegen einen entfernten Host testet (eigene Wegwerf-DB),
 * setzt E2E_ALLOW_REMOTE_DB=1.
 */
function pruefeLokaleDatenbank(url: string): void {
  if (process.env.E2E_ALLOW_REMOTE_DB === "1") return;
  let host: string;
  try {
    // Klammern nur bei IPv6 ("[::1]"), sie gehören nicht zum Namen.
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    // Nicht parsbare URL: der Verbindungsversuch unten scheitert
    // ohnehin, hier nicht zusätzlich raten.
    return;
  }
  if (LOKALE_DB_HOSTS.has(host)) return;
  throw new Error(
    `E2E-Lauf abgebrochen: DATABASE_URL zeigt auf "${host}". ` +
      "globalSetup leert ALLE Tabellen (TRUNCATE CASCADE) und lässt " +
      "deshalb nur lokale Hosts zu. Ist das wirklich eine Wegwerf-" +
      "Datenbank, E2E_ALLOW_REMOTE_DB=1 setzen.",
  );
}

/**
 * Leert alle App-Tabellen vor dem E2E-Lauf, damit die Tests
 * deterministisch sind (u. a. "erste Registrierung wird Admin"),
 * und löscht Rate-Limit-Zähler, damit wiederholte Läufe nicht am
 * Registrierungs-Limit scheitern.
 */
export default async function globalSetup() {
  loadEnv({ path: path.resolve(__dirname, "../.env"), quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt für den E2E-Lauf");
  pruefeLokaleDatenbank(url);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      // Nach dem vereinigten Schema: Attachment statt Upload,
      // Favorite statt PageFavorite. Eine falsche Tabelle hier
      // bricht den gesamten Lauf schon im globalSetup ab.
      `TRUNCATE "User","Space","SpaceMember","Page","PageVersion","CollabDocument","SpaceInvitation","PasswordResetToken","PageLink","Comment","Notification","PageChunk","Attachment","Favorite","PageVisit","AuditLog","Session","PageSubscription","PageShare","Group","GroupMember","SpaceGroup","PageGrant","TotpRecoveryCode" CASCADE`,
    );
  } finally {
    await client.end();
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    try {
      const keys = await redis.keys("dokunc:rl:*");
      if (keys.length) await redis.del(...keys);
    } catch {
      /* Rate-Limit-Reset ist best effort */
    } finally {
      redis.disconnect();
    }
  }
}
