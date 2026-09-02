import path from "node:path";
import { Client } from "pg";
import { Redis } from "ioredis";
import { config as loadEnv } from "dotenv";

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

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE "User","Space","SpaceMember","Page","PageVersion","CollabDocument","SpaceInvitation","PasswordResetToken","PageLink","Comment","Notification","PageChunk","Attachment","Favorite","PageVisit" CASCADE',
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
