import { NextResponse } from "next/server";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { audit } from "@/lib/audit";
import { LABEL_OHNE_ZUGRIFF } from "@/lib/link-labels";
import { titlesForUser } from "@/lib/link-titles";

export const runtime = "nodejs";

/**
 * Datenauskunft: alles, was die Instanz über die anfragende Person
 * gespeichert hat, als JSON zum Herunterladen.
 *
 * Bewusst nur die eigenen Daten und ohne Passworthash. Auf ein
 * Auskunftsbegehren liess sich vorher nur mit SQL antworten.
 *
 * Titel von Seiten nur, wenn die Person die Seite heute oeffnen darf
 * (dieselbe Regel wie fuer Wiki-Links, lib/link-titles). Favoriten, Abos,
 * Kommentare und Versionen koennen auf Seiten zeigen, die inzwischen
 * geschuetzt, geloescht oder in einem verlassenen Space sind; ihr
 * aktueller Titel, auch nach einer Umbenennung durch andere, gehoert
 * nicht zu den eigenen Daten. Dort stehen nur die ID und der Hinweis.
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

  const sichtbar = await titlesForUser(user.id, [
    ...comments.map((c) => c.page.id),
    ...versions.map((v) => v.page.id),
    ...favorites.map((f) => f.page.id),
    ...subscriptions.map((s) => s.page.id),
  ]);
  const offen = (id: string) => sichtbar.get(id) != null;
  const seite = <T extends { id: string }>(p: T) =>
    offen(p.id) ? p : { id: p.id, title: null, note: LABEL_OHNE_ZUGRIFF };

  await audit({ action: "account.exported", actorId: user.id });

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      profile,
      memberships,
      comments: comments.map((c) => ({ ...c, page: seite(c.page) })),
      pageVersions: versions.map((v) => ({
        ...v,
        title: offen(v.page.id) ? v.title : null,
        page: seite(v.page),
      })),
      notifications,
      sessions,
      favorites: favorites.map((f) => ({ ...f, page: seite(f.page) })),
      subscriptions: subscriptions.map((s) => ({ ...s, page: seite(s.page) })),
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
