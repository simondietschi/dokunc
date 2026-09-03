import { redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { TemplatesView } from "./TemplatesView";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role } = await loadSpace(slug);
  if (!can(role, "managePages")) redirect(`/s/${slug}`);

  const templates = await prisma.page.findMany({
    where: { spaceId: space.id, isTemplate: true, deletedAt: null },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      lastEditedBy: { select: { name: true } },
    },
  });

  return (
    <TemplatesView slug={slug} spaceName={space.name} templates={templates} />
  );
}
