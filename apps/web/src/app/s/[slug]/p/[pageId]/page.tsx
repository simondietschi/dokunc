import { notFound } from "next/navigation";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { getRawToken } from "@/lib/session";
import { CollaborativeEditor } from "./CollaborativeEditor";
import { TitleBar } from "./TitleBar";

export default async function PageView({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}) {
  const { slug, pageId } = await params;
  const { space, role, user } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id },
    select: { id: true, title: true },
  });
  if (!page) notFound();

  const token = (await getRawToken()) ?? "";
  const collabUrl =
    process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:3001";

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <TitleBar
        slug={slug}
        pageId={page.id}
        title={page.title}
        canWrite={can(role, "write")}
        canManage={can(role, "managePages")}
      />
      <CollaborativeEditor
        pageId={page.id}
        token={token}
        collabUrl={collabUrl}
        editable={can(role, "write")}
        userName={user.name}
      />
    </div>
  );
}
