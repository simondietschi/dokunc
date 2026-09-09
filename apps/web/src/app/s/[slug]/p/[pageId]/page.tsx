import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link2 } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { CollaborativeEditor } from "./CollaborativeEditor";
import { CommentsPanel } from "./comments/CommentsPanel";

/** Seitentitel im Browser-Tab und im Verlauf statt eines globalen Titels. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ pageId: string }>;
}): Promise<Metadata> {
  const { pageId } = await params;
  // Bewusst ohne Space-Prüfung: nur der Titel, und die Seite selbst
  // autorisiert unmittelbar danach.
  const page = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { title: true },
  });
  return { title: page?.title || "Ohne Titel" };
}

export default async function PageView({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}) {
  const { slug, pageId } = await params;
  const { space, role, user } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: { id: pageId, spaceId: space.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      icon: true,
      coverUrl: true,
      isTemplate: true,
    },
  });
  if (!page) notFound();

  // Besuch vermerken (für "zuletzt besucht" in der Seitenleiste).
  // Fehler hier dürfen die Seite nicht kippen.
  await prisma.pageVisit
    .upsert({
      where: { userId_pageId: { userId: user.id, pageId: page.id } },
      create: { userId: user.id, pageId: page.id },
      update: { visitedAt: new Date() },
    })
    .catch(() => {});

  const collabUrl =
    process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:3001";

  const [backlinks, comments, lastVersion, subscription, favorite, shares] =
    await Promise.all([
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
    // Wer zuletzt gespeichert hat: der Collab-Server schreibt Snapshots
    // mit Autor, das ist die einzige Autorenspur pro Seite.
    prisma.pageVersion.findFirst({
      where: { pageId: page.id },
      orderBy: { createdAt: "desc" },
      select: { author: { select: { name: true } } },
    }),
    prisma.pageSubscription.findUnique({
      where: { userId_pageId: { userId: user.id, pageId: page.id } },
      select: { id: true },
    }),
    prisma.pageFavorite.findUnique({
      where: { userId_pageId: { userId: user.id, pageId: page.id } },
      select: { id: true },
    }),
    prisma.pageShare.findMany({
      where: { pageId: page.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        includeChildren: true,
      },
      take: 20,
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
        collabUrl={collabUrl}
        editable={can(role, "write")}
        canManage={can(role, "managePages")}
        userId={user.id}
        userName={user.name}
        pdfEnabled={!!process.env.GOTENBERG_URL}
        updatedAt={page.updatedAt.toISOString()}
        lastEditorName={lastVersion?.author?.name ?? null}
        commentThreadIds={comments.map((c) => c.id)}
        icon={page.icon}
        coverUrl={page.coverUrl}
        isTemplate={page.isTemplate}
        isSubscribed={!!subscription}
        isFavorite={!!favorite}
        shares={shares.map((s) => ({
          id: s.id,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt?.toISOString() ?? null,
          includeChildren: s.includeChildren,
        }))}
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
          canComment={can(role, "comment")}
          canAnnotate={can(role, "write")}
          threads={comments.map((c) => ({
            id: c.id,
            body: c.body,
            anchorText: c.anchorText,
            resolved: !!c.resolvedAt,
            createdAt: c.createdAt.toISOString(),
            // Prisma setzt updatedAt beim Anlegen mit; erst ein
            // spürbarer Abstand heisst wirklich "nachträglich geändert".
            edited: c.updatedAt.getTime() - c.createdAt.getTime() > 1000,
            author: c.author
              ? { id: c.author.id, name: c.author.name }
              : null,
            replies: c.replies.map((r) => ({
              id: r.id,
              body: r.body,
              createdAt: r.createdAt.toISOString(),
              edited: r.updatedAt.getTime() - r.createdAt.getTime() > 1000,
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
