import { redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";

export default async function SpaceIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space } = await loadSpace(slug);

  const first = await prisma.page.findFirst({
    where: { spaceId: space.id, parentId: null },
    orderBy: { position: "asc" },
    select: { id: true },
  });

  if (first) redirect(`/s/${slug}/p/${first.id}`);

  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      Wähle oder erstelle eine Seite.
    </div>
  );
}
