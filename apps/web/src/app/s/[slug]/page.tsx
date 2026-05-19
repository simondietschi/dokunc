import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
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
    <div className="flex h-full flex-col items-center justify-center px-6 text-center animate-[rise_0.4s_ease]">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-subtle">
        <FileText className="h-6 w-6 text-faint" />
      </div>
      <h2 className="mt-5 text-lg font-semibold tracking-tight">
        Noch nichts hier
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted">
        Erstelle links über „Neue Seite" die erste Seite in diesem Space.
      </p>
    </div>
  );
}
