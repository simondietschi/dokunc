import type { PrismaClient } from "./generated/prisma/client";
import { INSTANCE_STATE_ID } from "./restore-epoch";

/**
 * Die eine Zeile von InstanceState, wie Web-App und Collab-Server sie
 * brauchen. Fehlt die Zeile, gilt alles als nicht gesetzt.
 */
export type InstanceStateRow = {
  /** Restore-Epoche (scripts/restore.sh), null = nie zurueckgespielt. */
  restoreEpoch: string | null;
  /** Hochwassermarke des Editor-Schemas, 0 = noch keine. */
  editorSchemaVersion: number;
  /** Schema-Hash zur Marke, null = noch keiner. */
  editorSchemaHash: string | null;
};

/**
 * Restore-Epoche und Schema-Marke in einer Abfrage. Der Collab-Server
 * liest beides bei jeder Anmeldung; eine zweite Abfrage dafuer waere
 * ueberfluessig.
 */
export async function readInstanceState(
  client: Pick<PrismaClient, "instanceState">,
): Promise<InstanceStateRow> {
  const row = await client.instanceState.findUnique({
    where: { id: INSTANCE_STATE_ID },
    select: {
      restoreEpoch: true,
      editorSchemaVersion: true,
      editorSchemaHash: true,
    },
  });
  return {
    restoreEpoch: row?.restoreEpoch ?? null,
    editorSchemaVersion: row?.editorSchemaVersion ?? 0,
    editorSchemaHash: row?.editorSchemaHash ?? null,
  };
}

/**
 * Schema-Marke auf `eigen` heben, nie senken, und die Marke danach
 * zurueckgeben. Eine Anweisung (INSERT … ON CONFLICT mit GREATEST): zwei
 * Instanzen, die gleichzeitig starten, koennen sich nicht gegenseitig
 * ueberschreiben.
 *
 * Der Hash folgt der Version: er wird nur mit einer hoeheren Version
 * ersetzt, oder gesetzt, wenn noch keiner da ist. Bei gleicher Version
 * bleibt der erste; startet eine zweite Instanz mit derselben Version
 * und anderem Hash, sieht sie den Widerspruch und nimmt keine Editoren an.
 */
export async function raiseEditorSchemaMark(
  client: Pick<PrismaClient, "$queryRaw">,
  eigen: { version: number; hash: string },
): Promise<{ version: number; hash: string | null }> {
  const rows = await client.$queryRaw<
    { version: number; hash: string | null }[]
  >`
    INSERT INTO "InstanceState" ("id", "editorSchemaVersion", "editorSchemaHash")
    VALUES (${INSTANCE_STATE_ID}, ${eigen.version}, ${eigen.hash})
    ON CONFLICT ("id") DO UPDATE SET
      "editorSchemaVersion" = GREATEST(
        "InstanceState"."editorSchemaVersion",
        EXCLUDED."editorSchemaVersion"
      ),
      "editorSchemaHash" = CASE
        WHEN EXCLUDED."editorSchemaVersion" > "InstanceState"."editorSchemaVersion"
          THEN EXCLUDED."editorSchemaHash"
        WHEN "InstanceState"."editorSchemaHash" IS NULL
          AND EXCLUDED."editorSchemaVersion" = "InstanceState"."editorSchemaVersion"
          THEN EXCLUDED."editorSchemaHash"
        ELSE "InstanceState"."editorSchemaHash"
      END
    RETURNING "editorSchemaVersion" AS version, "editorSchemaHash" AS hash
  `;
  const row = rows[0];
  if (!row) throw new Error("InstanceState: Schema-Marke nicht geschrieben");
  return { version: Number(row.version), hash: row.hash };
}
