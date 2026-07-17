import { notFound, redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";

/**
 * Kanonische Seiten-URL: löst eine Page-ID zur Space-URL auf.
 * Wiki-Links verlinken hierher, damit sie space-unabhängig bleiben.
 */
export default async function PageRedirect({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const user = await requireUser();

  const page = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true, space: { select: { slug: true, id: true } } },
  });
  if (!page) notFound();

  const member = await prisma.spaceMember.findUnique({
    where: {
      userId_spaceId: { userId: user.id, spaceId: page.space.id },
    },
    select: { id: true },
  });
  if (!member) redirect("/spaces");

  redirect(`/s/${page.space.slug}/p/${page.id}`);
}
