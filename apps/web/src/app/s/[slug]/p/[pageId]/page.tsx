import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { Link2, FileText, Plus, CornerDownRight } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { getRawToken } from "@/lib/session";
import { resolveCollabUrl } from "@/lib/collab-url";
import { CollaborativeEditor } from "./CollaborativeEditor";
import { CommentsPanel } from "./comments/CommentsPanel";
import { VisitTracker } from "@/components/editor/VisitTracker";
import { createPageAction } from "../../actions";

type Crumb = { id: string; title: string; icon: string | null };

export default async function PageView({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}) {
  const { slug, pageId } = await params;
  const { space, role, user } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, deletedAt: null },
    select: { id: true, title: true, icon: true, cover: true },
  });
  if (!page) notFound();

  const token = (await getRawToken()) ?? "";
  const requestHeaders = await headers();
  const collabUrl = resolveCollabUrl({
    configured: process.env.NEXT_PUBLIC_COLLAB_URL,
    host: requestHeaders.get("host"),
    proto: requestHeaders.get("x-forwarded-proto"),
  });

  const [backlinks, comments, ancestors, children, favorite] = await Promise.all([
    prisma.pageLink.findMany({
      where: { targetPageId: page.id, source: { deletedAt: null } },
      select: { source: { select: { id: true, title: true, icon: true } } },
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
    // Vorfahren (Breadcrumb), Wurzel zuerst; Space-Grenze im Join.
    prisma.$queryRaw<(Crumb & { depth: number })[]>`
      WITH RECURSIVE up AS (
        SELECT p.id, p."parentId", p.title, p.icon, 0 AS depth
        FROM "Page" p WHERE p.id = ${page.id} AND p."spaceId" = ${space.id}
        UNION ALL
        SELECT p.id, p."parentId", p.title, p.icon, up.depth + 1
        FROM "Page" p JOIN up ON p.id = up."parentId"
        WHERE p."spaceId" = ${space.id} AND up.depth < 32
      )
      SELECT id, title, icon, depth FROM up WHERE depth > 0 ORDER BY depth DESC
    `,
    prisma.page.findMany({
      where: { parentId: page.id, spaceId: space.id, deletedAt: null },
      orderBy: [{ position: "asc" }, { title: "asc" }],
      select: { id: true, title: true, icon: true },
    }),
    prisma.favorite.findUnique({
      where: { userId_pageId: { userId: user.id, pageId: page.id } },
      select: { userId: true },
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
        icon={page.icon}
        cover={page.cover}
        token={token}
        collabUrl={collabUrl}
        editable={can(role, "write")}
        canManage={can(role, "managePages")}
        userName={user.name}
        pdfEnabled={!!process.env.GOTENBERG_URL}
        ancestors={ancestors.map(({ id, title, icon }) => ({ id, title, icon }))}
        isFavorite={!!favorite}
      />
      <VisitTracker slug={slug} pageId={page.id} />

      <div className="mx-auto max-w-[760px] px-6 pb-24">
        {(children.length > 0 || can(role, "managePages")) && (
          <section className="mt-2 rounded-xl border border-line bg-surface/60 p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
              <CornerDownRight className="h-3.5 w-3.5" />
              Unterseiten
            </h2>
            {children.length > 0 ? (
              <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {children.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/s/${slug}/p/${c.id}`}
                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink transition-colors hover:bg-subtle"
                    >
                      {c.icon ? (
                        <span aria-hidden className="text-[15px] leading-none">
                          {c.icon}
                        </span>
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-faint" />
                      )}
                      <span className="truncate">{c.title || "Untitled"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12.5px] text-faint">
                Noch keine Unterseiten.
              </p>
            )}
            {can(role, "managePages") && (
              <form action={createPageAction} className="mt-2">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="parentId" value={page.id} />
                <button className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] text-muted transition-colors hover:bg-subtle hover:text-ink">
                  <Plus className="h-3.5 w-3.5" />
                  Unterseite anlegen
                </button>
              </form>
            )}
          </section>
        )}

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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {source.icon && <span aria-hidden>{source.icon}</span>}
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
