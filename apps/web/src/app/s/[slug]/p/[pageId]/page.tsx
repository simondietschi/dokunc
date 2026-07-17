import Link from "next/link";
import { notFound } from "next/navigation";
import { Link2 } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { getRawToken } from "@/lib/session";
import { CollaborativeEditor } from "./CollaborativeEditor";
import { CommentsPanel } from "./comments/CommentsPanel";

export default async function PageView({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}) {
  const { slug, pageId } = await params;
  const { space, role, user } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!page) notFound();

  const token = (await getRawToken()) ?? "";
  const collabUrl =
    process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:3001";

  const [backlinks, comments] = await Promise.all([
    prisma.pageLink.findMany({
      where: { targetPageId: page.id, source: { deletedAt: null } },
      select: { source: { select: { id: true, title: true } } },
      take: 50,
    }),
    prisma.comment.findMany({
      where: { pageId: page.id, parentId: null },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, name: true } },
        replies: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true } } },
        },
      },
    }),
  ]);

  return (
    <div>
      <CollaborativeEditor
        key={page.id}
        slug={slug}
        spaceId={space.id}
        pageId={page.id}
        title={page.title}
        token={token}
        collabUrl={collabUrl}
        editable={can(role, "write")}
        canManage={can(role, "managePages")}
        userName={user.name}
        pdfEnabled={!!process.env.GOTENBERG_URL}
      />

      <div className="mx-auto max-w-[760px] px-6 pb-24">
        {backlinks.length > 0 && (
          <section className="mt-4 border-t border-line pt-6">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
              <Link2 className="h-3.5 w-3.5" />
              Wird referenziert von
            </h2>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {backlinks.map(({ source }) => (
                <li key={source.id}>
                  <Link
                    href={`/s/${slug}/p/${source.id}`}
                    className="inline-flex items-center rounded-lg border border-line bg-surface px-2.5 py-1 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {source.title || "Untitled"}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <CommentsPanel
          slug={slug}
          pageId={page.id}
          currentUserId={user.id}
          canComment={can(role, "write")}
          threads={comments.map((c) => ({
            id: c.id,
            body: c.body,
            anchorText: c.anchorText,
            resolved: !!c.resolvedAt,
            createdAt: c.createdAt.toISOString(),
            author: c.author
              ? { id: c.author.id, name: c.author.name }
              : null,
            replies: c.replies.map((r) => ({
              id: r.id,
              body: r.body,
              createdAt: r.createdAt.toISOString(),
              author: r.author
                ? { id: r.author.id, name: r.author.name }
                : null,
            })),
          }))}
        />
      </div>
    </div>
  );
}
