"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str, strOrNull } from "@/lib/form";
import { audit } from "@/lib/audit";
import { evictCollabDocument } from "@/lib/collab-control";
import {
  findLivePage,
  findRestorableVersion,
  findTrashedPage,
  renamePageInSpace,
  resolveParentId,
  restorePageTree,
  trashPageTree,
} from "@/lib/page-guards";

export async function createPageAction(form: FormData) {
  const { space } = await authorizeAction(form, "managePages");
  const parentId = await resolveParentId(
    space.id,
    strOrNull(form, "parentId"),
  );
  const page = await prisma.page.create({
    data: { spaceId: space.id, parentId, title: "Untitled" },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}/p/${page.id}`);
}

export async function renamePageAction(form: FormData) {
  const { space } = await authorizeAction(form, "write");
  // Auf den Space eingegrenzt: die pageId kommt aus dem Formular.
  const renamed = await renamePageInSpace(
    space.id,
    str(form, "pageId"),
    str(form, "title"),
  );
  if (!renamed) throw new Error("Seite gehört nicht zu diesem Space");
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function deletePageAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");

  const page = await findLivePage(space.id, pageId);
  if (!page) redirect(`/s/${space.slug}`);

  // Soft-Delete: Seite + gesamter Unterbaum in den Papierkorb (kein
  // harter, unwiderruflicher Verlust).
  await trashPageTree(space.id, page.id);
  await audit({
    action: "page.deleted",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { title: page.title },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  redirect(`/s/${space.slug}`);
}

export async function restorePageAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");
  const page = await findTrashedPage(space.id, pageId);
  if (!page) {
    revalidatePath(`/s/${space.slug}/trash`);
    return;
  }
  // Seite + (gelöschten) Unterbaum wiederherstellen.
  await restorePageTree(space.id, page.id);
  await audit({
    action: "page.restored",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { title: page.title },
  });
  revalidatePath(`/s/${space.slug}/trash`);
  revalidatePath(`/s/${space.slug}`, "layout");
}

export async function purgePageAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "managePages");
  const pageId = str(form, "pageId");
  const page = await findTrashedPage(space.id, pageId);
  if (!page) {
    revalidatePath(`/s/${space.slug}/trash`);
    return;
  }
  // Endgültig (Kaskade entfernt Unterseiten, Versionen, Collab-State).
  await prisma.page.delete({ where: { id: page.id } });
  await audit({
    action: "page.purged",
    actorId: user.id,
    spaceId: space.id,
    targetId: page.id,
    metadata: { title: page.title },
  });
  revalidatePath(`/s/${space.slug}/trash`);
}

export async function restoreVersionAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "write");
  const version = await findRestorableVersion(
    space.id,
    str(form, "versionId"),
  );
  if (!version) throw new Error("Version nicht gefunden");

  // Erst die offenen Sitzungen räumen, dann schreiben: sonst schreibt
  // eine noch laufende Collab-Sitzung den alten Stand direkt zurück.
  await evictCollabDocument(version.pageId);

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
  await audit({
    action: "page.version_restored",
    actorId: user.id,
    spaceId: space.id,
    targetId: version.pageId,
    metadata: {
      versionId: version.id,
      versionCreatedAt: version.createdAt.toISOString(),
    },
  });
  revalidatePath(`/s/${space.slug}/p/${version.pageId}`);
  redirect(`/s/${space.slug}/p/${version.pageId}`);
}
