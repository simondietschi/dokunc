import { redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { visiblePageWhere } from "@/lib/page-access";
import { TemplatesView } from "./TemplatesView";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, user, role } = await loadSpace(slug);
  if (!can(role, "managePages")) redirect(`/s/${slug}`);

  // Dieselbe Sichtbarkeitsbedingung wie der Vorlagen-Picker im Layout.
  // Eine Vorlage laesst sich schuetzen — togglePageRestrictionAction
  // klammert sie nicht aus, findLivePage prueft nur deletedAt. Ohne die
  // Bedingung stuende eine geschuetzte Vorlage hier mit Titel und
  // letztem Bearbeiter, waehrend sie im Picker fehlt: `managePages` hat
  // auch MEMBER, die Standardrolle beim Beitritt zu einem offenen Space.
  const templates = await prisma.page.findMany({
    where: {
      spaceId: space.id,
      isTemplate: true,
      deletedAt: null,
      ...visiblePageWhere(user.id, role),
    },
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
