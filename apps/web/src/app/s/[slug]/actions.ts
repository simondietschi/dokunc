"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { requireUser, getMembership } from "@/lib/current-user";
import { can } from "@/lib/permissions";

async function spaceBySlug(slug: string) {
  const space = await prisma.space.findUnique({ where: { slug } });
  if (!space) throw new Error("Space nicht gefunden");
  return space;
}

export async function createPageAction(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get("slug"));
  const parentId = (formData.get("parentId") as string) || null;
  const space = await spaceBySlug(slug);
  const role = await getMembership(user.id, space.id);
  if (!can(role, "managePages")) throw new Error("Keine Berechtigung");

  const page = await prisma.page.create({
    data: { spaceId: space.id, parentId, title: "Untitled" },
  });
  revalidatePath(`/s/${slug}`);
  redirect(`/s/${slug}/p/${page.id}`);
}

export async function renamePageAction(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get("slug"));
  const pageId = String(formData.get("pageId"));
  const title = String(formData.get("title") ?? "").trim() || "Untitled";
  const space = await spaceBySlug(slug);
  const role = await getMembership(user.id, space.id);
  if (!can(role, "write")) throw new Error("Keine Berechtigung");

  await prisma.page.update({ where: { id: pageId }, data: { title } });
  revalidatePath(`/s/${slug}`);
}

export async function deletePageAction(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get("slug"));
  const pageId = String(formData.get("pageId"));
  const space = await spaceBySlug(slug);
  const role = await getMembership(user.id, space.id);
  if (!can(role, "managePages")) throw new Error("Keine Berechtigung");

  await prisma.page.delete({ where: { id: pageId } });
  revalidatePath(`/s/${slug}`);
  redirect(`/s/${slug}`);
}

export async function restoreVersionAction(formData: FormData) {
  const user = await requireUser();
  const slug = String(formData.get("slug"));
  const versionId = String(formData.get("versionId"));
  const space = await spaceBySlug(slug);
  const role = await getMembership(user.id, space.id);
  if (!can(role, "write")) throw new Error("Keine Berechtigung");

  const version = await prisma.pageVersion.findUnique({
    where: { id: versionId },
  });
  if (!version) throw new Error("Version nicht gefunden");

  await prisma.$transaction([
    prisma.page.update({
      where: { id: version.pageId },
      data: {
        title: version.title,
        content: version.content ?? undefined,
        textContent: version.textContent,
      },
    }),
    // Yjs-Status verwerfen, damit der Collab-Server aus content neu seedet.
    prisma.collabDocument.deleteMany({ where: { pageId: version.pageId } }),
  ]);
  revalidatePath(`/s/${slug}/p/${version.pageId}`);
  redirect(`/s/${slug}/p/${version.pageId}`);
}
