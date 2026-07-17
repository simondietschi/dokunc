"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str } from "@/lib/form";

/** Client-generierte Thread-IDs (crypto.randomUUID) validieren. */
function isValidThreadId(id: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(id);
}

export async function createThreadAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "write");
  const pageId = str(form, "pageId");
  const threadId = str(form, "threadId");
  const body = str(form, "body");
  const anchorText = str(form, "anchorText").slice(0, 300) || null;
  if (!body || !isValidThreadId(threadId)) return;

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, deletedAt: null },
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
  revalidatePath(`/s/${space.slug}/p/${pageId}`);
}

export async function replyAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "write");
  const threadId = str(form, "threadId");
  const body = str(form, "body");
  if (!body) return;

  const thread = await prisma.comment.findFirst({
    where: {
      id: threadId,
      parentId: null,
      page: { spaceId: space.id },
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

  // Thread-Teilnehmende benachrichtigen (außer der antwortenden Person).
  const participants = new Set(
    [thread.authorId, ...thread.replies.map((r) => r.authorId)].filter(
      (id): id is string => !!id && id !== user.id,
    ),
  );
  if (participants.size > 0) {
    await prisma.notification.createMany({
      data: [...participants].map((userId) => ({
        userId,
        actorId: user.id,
        type: "COMMENT_REPLY" as const,
        pageId: thread.pageId,
        commentId: reply.id,
      })),
    });
  }
  revalidatePath(`/s/${space.slug}/p/${thread.pageId}`);
}

export async function resolveThreadAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  const threadId = str(form, "threadId");
  const thread = await prisma.comment.findFirst({
    where: { id: threadId, parentId: null, page: { spaceId: space.id } },
    select: { id: true, pageId: true, resolvedAt: true },
  });
  if (!thread) return;

  await prisma.comment.update({
    where: { id: thread.id },
    data: { resolvedAt: thread.resolvedAt ? null : new Date() },
  });
  revalidatePath(`/s/${space.slug}/p/${thread.pageId}`);
}

export async function deleteCommentAction(form: FormData) {
  const { space, user, role } = await authorizeAction(form, "write");
  const commentId = str(form, "commentId");
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, page: { spaceId: space.id } },
    select: { id: true, pageId: true, authorId: true },
  });
  if (!comment) return;

  // Nur eigene Kommentare — oder Space-Verwaltung darf moderieren.
  const canModerate = role === "OWNER" || role === "ADMIN";
  if (comment.authorId !== user.id && !canModerate) return;

  await prisma.comment.delete({ where: { id: comment.id } });
  revalidatePath(`/s/${space.slug}/p/${comment.pageId}`);
}
