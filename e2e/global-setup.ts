import path from "node:path";
import { Client } from "pg";
import { config as loadEnv } from "dotenv";

/**
 * Leert alle App-Tabellen vor dem E2E-Lauf, damit die Tests
 * deterministisch sind (u. a. "erste Registrierung wird Admin").
 */
export default async function globalSetup() {
  loadEnv({ path: path.resolve(__dirname, "../.env"), quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt für den E2E-Lauf");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE "User","Space","SpaceMember","Page","PageVersion","CollabDocument","SpaceInvitation","PasswordResetToken" CASCADE',
    );
  } finally {
    await client.end();
  }
}
