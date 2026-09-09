"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { str } from "@/lib/form";
import { sendCommentEmail } from "@/lib/mail";
import { publishNotification } from "@/lib/notify-bus";
import { filterByPageAccess, visiblePageWhere } from "@/lib/page-access";

/** Client-generierte Thread-IDs (crypto.randomUUID) validieren. */
function isValidThreadId(id: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(id);
}

export async function createThreadAction(form: FormData) {
  const access = await authorizeAction(form, "comment");
  const { space, user } = access;
  const pageId = str(form, "pageId");
  const threadId = str(form, "threadId");
  const body = str(form, "body");
  const anchorText = str(form, "anchorText").slice(0, 300) || null;
  if (!body || !isValidThreadId(threadId)) return;

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      spaceId: space.id,
      deletedAt: null,
      ...visiblePageWhere(user.id, access.role),
    },
    select: { id: true },
  });
  if (!page) return;

  await prisma.comment.create({
    data: {
      id: threadId,
      pageId,
      authorId: user.id,
      body,
      anchorText,
    },
  });
  await notifyNewThread(pageId, space.id, threadId, user.id, body);
  revalidatePath(`/s/${space.slug}/p/${pageId}`);
}

/**
 * Wer erfährt von einem neuen Thread?
 *
 * Alle, die auf dieser Seite schon einmal kommentiert oder an ihr
 * geschrieben haben — nicht der ganze Space. Ohne diese Runde blieb
 * `NotificationType.COMMENT` reine Theorie: nur Antworten lösten
 * überhaupt eine Benachrichtigung aus, ein neuer Thread nie.
 */
async function notifyNewThread(
  pageId: string,
  spaceId: string,
  commentId: string,
  actorId: string,
  body: string,
): Promise<void> {
  const [commenters, editors, followers] = await Promise.all([
    prisma.comment.findMany({
      where: { pageId, authorId: { not: null } },
      select: { authorId: true },
      distinct: ["authorId"],
      take: 50,
    }),
    prisma.pageVersion.findMany({
      where: { pageId, authorId: { not: null } },
      select: { authorId: true },
      distinct: ["authorId"],
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    // Wer der Seite ausdrücklich folgt, will es auch ohne eigene
    // Vorgeschichte wissen.
    prisma.pageSubscription.findMany({
      where: { pageId },
      select: { userId: true },
      take: 200,
    }),
  ]);

  const candidates = new Set(
    [
      ...commenters.map((r) => r.authorId),
      ...editors.map((r) => r.authorId),
      ...followers.map((r) => r.userId),
    ].filter((id): id is string => !!id && id !== actorId),
  );
  if (candidates.size === 0) return;

  await deliverCommentNotifications({
    recipients: [...candidates],
    spaceId,
    pageId,
    commentId,
    actorId,
    body,
    isReply: false,
  });
}

/**
 * Schreibt Benachrichtigungen und verschickt die zugehörigen E-Mails.
 *
 * Nur an aktuelle Mitglieder: wer den Space verlassen hat, soll nichts
 * mehr über Inhalte erfahren, die er nicht mehr sieht. Der Mailversand
 * läuft nach dem Schreiben und kippt die Aktion nie.
 */
async function deliverCommentNotifications(opts: {
  recipients: string[];
  spaceId: string;
  pageId: string;
  commentId: string;
  actorId: string;
  body: string;
  isReply: boolean;
}): Promise<void> {
  const members = await prisma.user.findMany({
    // Zugang über eigene Mitgliedschaft oder eine Gruppe — und für eine
    // geschützte Seite zusätzlich die Freigabe. Sonst erführe jemand
    // über die Glocke von einem Kommentar auf einer Seite, die er nicht
    // öffnen kann.
    where: {
      id: { in: opts.recipients },
      OR: [
        { memberships: { some: { spaceId: opts.spaceId } } },
        {
          groupMemberships: {
            some: { group: { spaces: { some: { spaceId: opts.spaceId } } } },
          },
        },
      ],
    },
    select: { id: true, email: true, emailOnComment: true, isActive: true },
  });
  const allowed = await filterByPageAccess(opts.pageId, members);
  if (allowed.length === 0) return;

  await prisma.notification.createMany({
    data: allowed.map((m) => ({
      userId: m.id,
      actorId: opts.actorId,
      type: (opts.isReply ? "COMMENT_REPLY" : "COMMENT") as
        | "COMMENT"
        | "COMMENT_REPLY",
      pageId: opts.pageId,
      commentId: opts.commentId,
    })),
    skipDuplicates: true,
  });

  // Glocke sofort aktualisieren, nicht erst beim nächsten Aufruf.
  await publishNotification(allowed.map((m) => m.id));

  const wantMail = allowed.filter((m) => m.isActive && m.emailOnComment);
  if (wantMail.length === 0) return;

  const [actor, page] = await Promise.all([
    prisma.user.findUnique({
      where: { id: opts.actorId },
      select: { name: true },
    }),
    prisma.page.findUnique({
      where: { id: opts.pageId },
      select: { title: true },
    }),
  ]);

  await Promise.all(
    wantMail.map((m) =>
      sendCommentEmail({
        to: m.email,
        actorName: actor?.name ?? "Jemand",
        pageTitle: page?.title || "Ohne Titel",
        pageId: opts.pageId,
        body: opts.body,
        isReply: opts.isReply,
      }),
    ),
  );
}

export async function replyAction(form: FormData) {
  const access = await authorizeAction(form, "comment");
  const { space, user } = access;
  const threadId = str(form, "threadId");
  const body = str(form, "body");
  if (!body) return;

  const thread = await prisma.comment.findFirst({
    where: {
      id: threadId,
      parentId: null,
      page: { spaceId: space.id, ...visiblePageWhere(user.id, access.role) },
    },
    include: {
      replies: { select: { authorId: true } },
    },
  });
  if (!thread) return;

  const reply = await prisma.comment.create({
    data: {
      pageId: thread.pageId,
      parentId: thread.id,
      authorId: user.id,
      body,
    },
  });

  // Thread-Teilnehmende und Folgende benachrichtigen (ausser der
  // antwortenden Person).
  const followers = await prisma.pageSubscription.findMany({
    where: { pageId: thread.pageId },
    select: { userId: true },
    take: 200,
  });
  const participants = new Set(
    [
      thread.authorId,
      ...thread.replies.map((r) => r.authorId),
      ...followers.map((f) => f.userId),
    ].filter((id): id is string => !!id && id !== user.id),
  );
  if (participants.size > 0) {
    await deliverCommentNotifications({
      recipients: [...participants],
      spaceId: space.id,
      pageId: thread.pageId,
      commentId: reply.id,
      actorId: user.id,
      body,
      isReply: true,
    });
  }
  revalidatePath(`/s/${space.slug}/p/${thread.pageId}`);
}

export async function resolveThreadAction(form: FormData) {
  const { space, user, role } = await authorizeAction(form, "comment");
  const threadId = str(form, "threadId");
  const thread = await prisma.comment.findFirst({
    where: {
      id: threadId,
      parentId: null,
      page: { spaceId: space.id, ...visiblePageWhere(user.id, role) },
    },
    select: { id: true, pageId: true, resolvedAt: true, authorId: true },
  });
  if (!thread) return;

  // Erledigt setzen darf, wer schreiben darf — oder wer den Thread
  // selbst begonnen hat. Sonst könnte eine reine Lesegruppe fremde
  // Anmerkungen wegräumen.
  if (!can(role, "write") && thread.authorId !== user.id) return;

  await prisma.comment.update({
    where: { id: thread.id },
    data: { resolvedAt: thread.resolvedAt ? null : new Date() },
  });
  revalidatePath(`/s/${space.slug}/p/${thread.pageId}`);
}

export async function deleteCommentAction(form: FormData) {
  const { space, user, role } = await authorizeAction(form, "comment");
  const commentId = str(form, "commentId");
  const comment = await prisma.comment.findFirst({
    where: {
      id: commentId,
      page: { spaceId: space.id, ...visiblePageWhere(user.id, role) },
    },
    select: { id: true, pageId: true, authorId: true },
  });
  if (!comment) return;

  // Nur eigene Kommentare — oder Space-Verwaltung darf moderieren.
  const canModerate = role === "OWNER" || role === "ADMIN";
  if (comment.authorId !== user.id && !canModerate) return;

  await prisma.comment.delete({ where: { id: comment.id } });
  revalidatePath(`/s/${space.slug}/p/${comment.pageId}`);
}

/**
 * Eigenen Kommentar ändern.
 *
 * Bewusst nur die eigene Person: Moderation darf löschen, aber niemals
 * fremde Worte umschreiben.
 */
export async function editCommentAction(form: FormData) {
  const access = await authorizeAction(form, "comment");
  const { space, user } = access;
  const body = str(form, "body");
  if (!body) return;

  const comment = await prisma.comment.findFirst({
    where: {
      id: str(form, "commentId"),
      authorId: user.id,
      page: { spaceId: space.id, ...visiblePageWhere(user.id, access.role) },
    },
    select: { id: true, pageId: true },
  });
  if (!comment) return;

  await prisma.comment.update({
    where: { id: comment.id },
    data: { body },
  });
  revalidatePath(`/s/${space.slug}/p/${comment.pageId}`);
}

/** Einer Seite folgen oder nicht mehr folgen. */
export async function toggleSubscriptionAction(form: FormData) {
  const access = await authorizeAction(form, "read");
  const { space, user } = access;
  const pageId = str(form, "pageId");
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      spaceId: space.id,
      deletedAt: null,
      ...visiblePageWhere(user.id, access.role),
    },
    select: { id: true },
  });
  if (!page) return;

  const existing = await prisma.pageSubscription.findUnique({
    where: { userId_pageId: { userId: user.id, pageId: page.id } },
    select: { id: true },
  });
  if (existing) {
    await prisma.pageSubscription.delete({ where: { id: existing.id } });
  } else {
    await prisma.pageSubscription.create({
      data: { userId: user.id, pageId: page.id },
    });
  }
  revalidatePath(`/s/${space.slug}/p/${page.id}`);
}
