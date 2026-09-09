import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { prisma } from "@dokunc/db";
import { contentToHtml } from "@/lib/page-html";
import { resolveShare, rewriteFileUrls } from "@/lib/share";
import { Logo } from "@/components/ui/Logo";

/**
 * Geteilte Seite: Lesen ohne Konto.
 *
 * Bewusst statisch gerendert und ohne Editor, ohne Collab-Verbindung
 * und ohne Kommentare — ein Freigabelink gibt Lesezugriff auf genau
 * diese Seite, nichts weiter.
 */
export const metadata: Metadata = {
  title: "Geteilte Seite",
  // Freigegebene Inhalte gehören nicht in Suchmaschinen.
  robots: { index: false, follow: false },
};

export default async function SharedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; page?: string }>;
}) {
  const { id } = await params;
  const { token = "", page: wantedPageId } = await searchParams;

  const share = await resolveShare(id, token, wantedPageId);
  if (!share) notFound();

  const children = share.includeChildren
    ? await prisma.page.findMany({
        where: { parentId: share.page.id, deletedAt: null },
        orderBy: [{ position: "asc" }, { title: "asc" }],
        select: { id: true, title: true, icon: true },
        take: 100,
      })
    : [];

  const html = rewriteFileUrls(contentToHtml(share.page.content), id, token);
  const linkTo = (pageId: string) =>
    `/share/${id}?token=${encodeURIComponent(token)}&page=${pageId}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[820px] items-center justify-between px-6">
          <Logo />
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-muted">
            <Eye className="h-3.5 w-3.5" />
            Geteilte Ansicht
          </span>
        </div>
      </header>

      {share.page.coverUrl && (
        <div className="h-44 w-full overflow-hidden sm:h-56">
          <img
            src={rewriteFileUrls(share.page.coverUrl, id, token)}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <main className="mx-auto max-w-[760px] px-6 py-12">
        {share.page.icon && (
          <div className="mb-1 text-5xl leading-none">{share.page.icon}</div>
        )}
        <h1 className="text-[2.5rem] font-bold leading-tight tracking-tight">
          {share.page.title || "Ohne Titel"}
        </h1>
        <p className="mt-1.5 text-[13px] text-faint">
          aus „{share.spaceName}" ·{" "}
          <time dateTime={share.page.updatedAt.toISOString()}>
            {share.page.updatedAt.toLocaleDateString("de-CH", {
              dateStyle: "medium",
            })}
          </time>
        </p>

        <article
          className="dk-shared mt-8"
          // Aus dem eigenen Editor-Schema erzeugt; generateHTML gibt nur
          // aus, was das Schema kennt.
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {children.length > 0 && (
          <nav className="mt-12 border-t border-line pt-6">
            <h2 className="text-[13px] font-semibold text-muted">
              Unterseiten
            </h2>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {children.map((c) => (
                <li key={c.id}>
                  <Link
                    href={linkTo(c.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {c.icon && <span aria-hidden>{c.icon}</span>}
                    {c.title || "Ohne Titel"}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </main>
    </div>
  );
}
