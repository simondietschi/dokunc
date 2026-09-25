import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/Readiness: prüft DB-Erreichbarkeit. Keine Auth.
 *
 * Im Fehlerfall zusätzlich `error` wie in allen anderen Routen. `status`
 * und `db` bleiben daneben stehen: Überwachungen, die darauf prüfen,
 * sollen beim Update nicht still ins Leere greifen.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json(
      { status: "error", db: false, error: "Datenbank nicht erreichbar" },
      { status: 503 },
    );
  }
}
