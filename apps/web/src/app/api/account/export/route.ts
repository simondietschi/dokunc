import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Datenauskunft: alles, was die Instanz über die anfragende Person
 * gespeichert hat, als JSON zum Herunterladen.
 *
 * Bewusst nur die eigenen Daten und ohne Passworthash. Auf ein
 * Auskunftsbegehren liess sich vorher nur mit SQL antworten.
 */
export async function GET() {
  const user = await requireUser();

  const [
    profile,
    memberships,
    comments,
    versions,
    notifications,
    sessions,
    favorites,
    subscriptions,
    attachments,
    auditEvents,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        isAdmin: true,
        isActive: true,
        emailNotifications: true,
        // Nur das Datum, nie das Geheimnis selbst.
        totpEnabledAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.spaceMember.findMany({
      where: { userId: user.id },
      select: { role: true, space: { select: { name: true, slug: true } } },
    }),
    prisma.comment.findMany({
      where: { authorId: user.id },
      select: {
        id: true,
        body: true,
        anchorText: true,
        createdAt: true,
        page: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.pageVersion.findMany({
      where: { authorId: user.id },
      select: {
        id: true,
        title: true,
        createdAt: true,
        page: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.notification.findMany({
      where: { userId: user.id },
      select: { type: true, createdAt: true, readAt: true, pageId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.session.findMany({
      where: { userId: user.id },
      select: {
        userAgent: true,
        ip: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.favorite.findMany({
      where: { userId: user.id },
      select: { createdAt: true, page: { select: { id: true, title: true } } },
    }),
    prisma.pageSubscription.findMany({
      where: { userId: user.id },
      select: { createdAt: true, page: { select: { id: true, title: true } } },
    }),
    prisma.attachment.findMany({
      where: { uploaderId: user.id },
      select: {
        storedName: true,
        name: true,
        mimeType: true,
        kind: true,
        size: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { actorId: user.id },
      select: {
        action: true,
        targetId: true,
        metadata: true,
        ip: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
    }),
  ]);

  await audit({ action: "account.exported", actorId: user.id });

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      profile,
      memberships,
      comments,
      pageVersions: versions,
      notifications,
      sessions,
      favorites,
      subscriptions,
      attachments,
      auditEvents,
    },
    null,
    2,
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dokunc-daten.json"',
      "Cache-Control": "no-store",
    },
  });
}
