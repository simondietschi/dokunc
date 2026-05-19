"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";

export async function createPageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      parentId: strOrNull(form, "parentId"),
      title: "Untitled",
    },
  });
  revalidatePath(`/s/${space.slug}`);
  redirect(`/s/${space.slug}/p/${page.id}`);
}

export async function renamePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  await prisma.page.update({
    where: { id: str(form, "pageId") },
    data: { title: str(form, "title") || "Untitled" },
  });
  revalidatePath(`/s/${space.slug}`);
}

export async function deletePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  await prisma.page.delete({ where: { id: str(form, "pageId") } });
  revalidatePath(`/s/${space.slug}`);
  redirect(`/s/${space.slug}`);
}

export async function restoreVersionAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  const version = await prisma.pageVersion.findUnique({
    where: { id: str(form, "versionId") },
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
  revalidatePath(`/s/${space.slug}/p/${version.pageId}`);
  redirect(`/s/${space.slug}/p/${version.pageId}`);
}
