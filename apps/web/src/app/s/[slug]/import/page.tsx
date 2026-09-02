import { redirect } from "next/navigation";
import { FileUp } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { ImportForm } from "./ImportForm";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role } = await loadSpace(slug);
  if (!can(role, "managePages")) redirect(`/s/${slug}`);

  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, deletedAt: null },
    orderBy: [{ position: "asc" }, { title: "asc" }],
    select: { id: true, title: true, icon: true, parentId: true },
  });

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <FileUp className="h-5 w-5 text-muted" />
        Importieren
      </h1>
      <p className="mt-1 text-sm text-muted">
        Markdown-Dateien oder einen ZIP-Export (Ordnerstruktur, Obsidian,
        Notion) in „{space.name}“ übernehmen. Ordner werden zu Seiten mit
        Unterseiten, Bilder werden mitgenommen, relative Links zwischen den
        Dateien werden zu Wiki-Links.
      </p>
      <div className="mt-8">
        <ImportForm
          slug={slug}
          spaceId={space.id}
          pages={pages.filter((p) => p.parentId === null)}
        />
      </div>
      <ul className="mt-8 space-y-1.5 text-[12.5px] text-faint">
        <li>Erste Überschrift oder Front Matter <code>title:</code> wird zum Seitentitel.</li>
        <li><code>index.md</code>, <code>README.md</code> oder eine gleichnamige Datei füllt die Ordnerseite.</li>
        <li>Unterstützt: Tabellen, Aufgabenlisten, Codeblöcke mit Sprache, Mermaid, Bilder (PNG, JPG, GIF, WebP).</li>
        <li>Grenzen: 50 MB pro Upload, 1000 Dateien.</li>
      </ul>
    </div>
  );
}
