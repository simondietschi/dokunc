import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { Link2 } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { visiblePageWhere } from "@/lib/page-access";
import type {
  AccessCandidate,
  GrantRow,
} from "./AccessDialog";
import { can } from "@/lib/permissions";
import { resolveCollabUrl } from "@/lib/collab-url";
import { loadAncestors } from "@/lib/page-ancestors";
import { recordPageVisit } from "@/lib/page-visits";
import { CollaborativeEditor } from "./CollaborativeEditor";
import { CommentsPanel } from "./comments/CommentsPanel";
import { PageAttachments } from "@/components/space/PageAttachments";

/** Seitentitel im Browser-Tab und im Verlauf statt eines globalen Titels. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}): Promise<Metadata> {
  const { slug, pageId } = await params;

  /**
   * Auch der Titel im Browser-Tab ist eine Auskunft.
   *
   * Next löst die Metadaten unabhängig davon auf, ob die Seite selbst
   * später `notFound()` wirft — ein Titel, der hier ungeprüft entsteht,
   * bleibt im Dokument stehen. Deshalb dieselbe Hürde wie unten, und
   * bei Fehlschlag ein fester Fallback statt eines sprechenden.
   */
  try {
    const { space, role, user } = await loadSpace(slug);
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        spaceId: space.id,
        deletedAt: null,
        ...visiblePageWhere(user.id, role),
      },
      select: { title: true },
    });
    return { title: page?.title || "Seite" };
  } catch {
    // loadSpace leitet um oder wirft; für die Metadaten genügt der
    // neutrale Titel.
    return { title: "Seite" };
  }
}

export default async function PageView({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}) {
  const { slug, pageId } = await params;
  const { space, role, user } = await loadSpace(slug);

  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      spaceId: space.id,
      deletedAt: null,
      // Ohne Freigabe gibt es die Seite hier nicht — 404 statt 403,
      // sonst verriete die Fehlermeldung ihre Existenz.
      ...visiblePageWhere(user.id, role),
    },
    select: {
      id: true,
      title: true,
      parentId: true,
      updatedAt: true,
      icon: true,
      coverUrl: true,
      isTemplate: true,
      isRestricted: true,
      accessRootId: true,
    },
  });
  if (!page) notFound();

  // "Zuletzt besucht": nach dem Senden der Antwort, nie blockierend.
  after(() => recordPageVisit(user.id, page.id));

  const requestHeaders = await headers();
  const collabUrl = resolveCollabUrl({
    configured: process.env.NEXT_PUBLIC_COLLAB_URL,
    host: requestHeaders.get("host"),
    proto: requestHeaders.get("x-forwarded-proto"),
  });

  // Zugriffsangaben nur für die Seitenverwaltung: sonst wäre es ein
  // Verzeichnis aller Konten des Space für jede Person.
  const access = can(role, "managePages")
    ? await loadPageAccess(space.id, page)
    : EMPTY_ACCESS;

  const ancestorsPromise = loadAncestors(
    space.id,
    page.parentId,
    user.id,
    role,
  );
  const [
    backlinks,
    comments,
    lastVersion,
    subscription,
    favorite,
    shares,
    attachments,
    childCount,
  ] =
    await Promise.all([
    prisma.pageLink.findMany({
      where: {
        targetPageId: page.id,
        source: { deletedAt: null, ...visiblePageWhere(user.id, role) },
      },
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
    prisma.favorite.findUnique({
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
    prisma.attachment.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        size: true,
        mimeType: true,
        storedName: true,
        createdAt: true,
        uploader: { select: { name: true } },
      },
    }),
    prisma.page.count({
      where: { parentId: page.id, deletedAt: null },
    }),
  ]);
  const ancestors = await ancestorsPromise;

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
        access={access}
        breadcrumbs={{ spaceName: space.name, ancestors }}
        hasChildren={childCount > 0}
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

        <PageAttachments
          items={attachments.map((a) => ({
            id: a.id,
            name: a.name,
            size: a.size,
            mimeType: a.mimeType,
            url: `/api/files/${a.storedName}`,
            createdAt: a.createdAt,
            uploader: a.uploader?.name ?? null,
          }))}
        />

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

type PageAccess = {
  isRestricted: boolean;
  inheritedFrom: string | null;
  grants: GrantRow[];
  people: AccessCandidate[];
  groups: AccessCandidate[];
};

const EMPTY_ACCESS: PageAccess = {
  isRestricted: false,
  inheritedFrom: null,
  grants: [],
  people: [],
  groups: [],
};

/**
 * Schutzstatus, Freigabeliste und die noch wählbaren Personen und
 * Gruppen.
 *
 * Die Liste der Wählbaren ist bewusst auf den Space begrenzt: eine
 * Freigabe soll keinen Zugang schaffen, den es sonst nicht gäbe — genau
 * das prüft `addPageGrantAction` noch einmal.
 */
async function loadPageAccess(
  spaceId: string,
  page: { id: string; isRestricted: boolean; accessRootId: string | null },
): Promise<PageAccess> {
  const inherited =
    page.accessRootId && page.accessRootId !== page.id
      ? await prisma.page.findUnique({
          where: { id: page.accessRootId },
          select: { title: true },
        })
      : null;

  const [grants, members, memberGroups, spaceGroups] = await Promise.all([
    prisma.pageGrant.findMany({
      where: { pageId: page.accessRootId ?? page.id },
      select: {
        id: true,
        user: { select: { id: true, name: true, email: true } },
        group: {
          select: {
            id: true,
            name: true,
            _count: { select: { members: true } },
          },
        },
      },
    }),
    prisma.spaceMember.findMany({
      where: { spaceId },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.spaceGroup.findMany({
      where: { spaceId },
      select: {
        group: {
          select: {
            members: {
              select: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    }),
    prisma.spaceGroup.findMany({
      where: { spaceId },
      select: { group: { select: { id: true, name: true } } },
    }),
  ]);

  const grantRows: GrantRow[] = grants.map((g) =>
    g.group
      ? {
          id: g.id,
          kind: "group" as const,
          label: g.group.name,
          detail: `${g.group._count.members} ${
            g.group._count.members === 1 ? "Person" : "Personen"
          }`,
        }
      : {
          id: g.id,
          kind: "user" as const,
          label: g.user?.name ?? "Unbekannt",
          detail: g.user?.email ?? null,
        },
  );

  const grantedUserIds = new Set(
    grants.map((g) => g.user?.id).filter(Boolean),
  );
  const grantedGroupIds = new Set(
    grants.map((g) => g.group?.id).filter(Boolean),
  );

  const candidates = new Map<string, AccessCandidate>();
  for (const m of members) {
    if (!grantedUserIds.has(m.user.id)) {
      candidates.set(m.user.id, {
        id: m.user.id,
        label: m.user.name,
        detail: m.user.email,
      });
    }
  }
  for (const sg of memberGroups) {
    for (const m of sg.group.members) {
      if (!grantedUserIds.has(m.user.id)) {
        candidates.set(m.user.id, {
          id: m.user.id,
          label: m.user.name,
          detail: m.user.email,
        });
      }
    }
  }

  return {
    isRestricted: page.isRestricted,
    inheritedFrom: inherited?.title || (inherited ? "Ohne Titel" : null),
    grants: grantRows,
    people: [...candidates.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    groups: spaceGroups
      .filter((sg) => !grantedGroupIds.has(sg.group.id))
      .map((sg) => ({ id: sg.group.id, label: sg.group.name, detail: "" }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}
