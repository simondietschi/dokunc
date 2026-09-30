import { randomBytes } from "node:crypto";
import path from "node:path";
import { Client } from "pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../.env"), quiet: true });

/**
 * Weitere Konten und eigene Spaces fuer E2E-Tests, direkt per SQL.
 *
 * Der Weg ueber die Oberflaeche (Einladungslink, Registrierung) kostet
 * je Konto einige Sekunden und haengt an SMTP (mit SMTP gibt es keinen
 * Link). Wer nur eine zweite Person mit einer Rolle braucht, legt sie
 * hier an; das erste Konto aus first-account.setup.ts bleibt, wie es ist.
 */

/** Passwort aller Konten aus `zweitesKonto`. */
export const ZWEITES_PASSWORT = "Zweites-Konto-1!";
/**
 * bcrypt (Kosten 10) von ZWEITES_PASSWORT, fest eingetragen: der E2E-Lauf
 * braucht so kein bcrypt, und die Anmeldung prueft den Hash wie jeden
 * anderen.
 */
const ZWEITES_HASH = "$2b$10$adYiGL1FNRNxbVXXdnhcHOTOrd/ZyWVjks/m59UNYQfhLsMiNr7Ja";

/** E-Mail des ersten Kontos (first-account.setup.ts). */
export const ERSTES_KONTO = "e2e@dokunc.dev";

export type Rolle = "VIEWER" | "MEMBER" | "ADMIN" | "OWNER";
export type Konto = { id: string; email: string; passwort: string; name: string };

/**
 * Neue ID in der Form, die die App erzeugt (cuid: Kleinbuchstaben und
 * Ziffern). Manche Pruefungen verlangen sie, etwa die Titel der
 * Wiki-Links im Editor; eine ID wie "e2e-seite-1" gilt dort als ungueltig.
 */
export function neueId(): string {
  return `c${randomBytes(12).toString("hex")}`;
}

/** Fuehrt `fn` mit einer eigenen Datenbankverbindung aus. */
export async function mitDatenbank<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** Der erste Space ("E2E Space") des ersten Kontos. */
async function ersterSpace(db: Client): Promise<string> {
  const r = await db.query<{ id: string }>(
    `SELECT s.id FROM "Space" s
       JOIN "SpaceMember" m ON m."spaceId" = s.id
       JOIN "User" u ON u.id = m."userId"
      WHERE u.email = $1
      ORDER BY s."createdAt" ASC
      LIMIT 1`,
    [ERSTES_KONTO],
  );
  if (!r.rows[0]) throw new Error("Kein Space des ersten Kontos gefunden");
  return r.rows[0].id;
}

/**
 * Legt ein weiteres Konto an und macht es im Space zum Mitglied mit
 * dieser Rolle (ohne Angabe: der erste Space des ersten Kontos). Jeder
 * Aufruf ein neues Konto; `ZWEITES_PASSWORT` meldet es an.
 */
export async function zweitesKonto(
  rolle: Rolle,
  o: { spaceId?: string; name?: string } = {},
): Promise<Konto> {
  return mitDatenbank(async (db) => {
    const spaceId = o.spaceId ?? (await ersterSpace(db));
    const id = neueId();
    const email = `konto-${id}@dokunc.dev`;
    const name = o.name ?? `Konto ${rolle}`;
    await db.query(
      `INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt")
       VALUES ($1, $2, $3, $4, now())`,
      [id, email, name, ZWEITES_HASH],
    );
    await db.query(
      `INSERT INTO "SpaceMember" (id, "userId", "spaceId", role)
       VALUES ($1, $2, $3, $4::"SpaceRole")`,
      [neueId(), id, spaceId, rolle],
    );
    return { id, email, passwort: ZWEITES_PASSWORT, name };
  });
}

/**
 * Eigener Space mit dem ersten Konto als OWNER, fuer Tests, die den
 * ersten Space nicht veraendern sollen. Wer ihn anlegt, raeumt ihn mit
 * `entferneSpace` wieder ab: sonst stuende er bei den folgenden Dateien
 * in der Space-Liste.
 */
export async function eigenerSpace(name: string): Promise<{ id: string; slug: string }> {
  return mitDatenbank(async (db) => {
    const id = neueId();
    const slug = `e2e-${id}`;
    await db.query(
      `INSERT INTO "Space" (id, name, slug, "updatedAt") VALUES ($1, $2, $3, now())`,
      [id, name, slug],
    );
    await db.query(
      `INSERT INTO "SpaceMember" (id, "userId", "spaceId", role)
       SELECT $1, u.id, $2, 'OWNER' FROM "User" u WHERE u.email = $3`,
      [neueId(), id, ERSTES_KONTO],
    );
    return { id, slug };
  });
}

/** Space samt Seiten und Mitgliedschaften entfernen, dazu die genannten Konten. */
export async function entferneSpace(spaceId: string, konten: readonly Konto[] = []): Promise<void> {
  await mitDatenbank(async (db) => {
    await db.query(`DELETE FROM "Space" WHERE id = $1`, [spaceId]);
    if (konten.length) {
      await db.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [konten.map((k) => k.id)]);
    }
  });
}
