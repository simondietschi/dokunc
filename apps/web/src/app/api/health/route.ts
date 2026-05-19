import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness/Readiness: prüft DB-Erreichbarkeit. Keine Auth. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json(
      { status: "error", db: false },
      { status: 503 },
    );
  }
}
