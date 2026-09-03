import { redirect } from "next/navigation";
import { FileText, Globe, LayoutList, Upload } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { buildTree, type TreeNode } from "@/lib/page-tree";
import { importMaxMb } from "@/lib/import/limits";
import { ImportForm, type ParentOption } from "./ImportForm";

const FORMATS = [
  {
    icon: FileText,
    title: "Markdown",
    text: "Einzelne .md-Dateien oder ein Zip mit Ordnern. Ordner werden zu Elternseiten, index.md oder README.md liefert deren Inhalt. Relative Links und Bilder werden übernommen, ebenso Aufgabenlisten, Tabellen, Mermaid-Codeblöcke und GitHub-Hinweise (> [!NOTE]).",
  },
  {
    icon: Globe,
    title: "Confluence",
    text: "HTML-Export eines Space (Bereich exportieren, HTML). Die Hierarchie kommt aus der index.html, Info-, Hinweis- und Warnmakros werden zu Callouts, Code-Makros zu Codeblöcken, Anhangsbilder werden gespeichert.",
  },
  {
    icon: LayoutList,
    title: "Notion",
    text: "Export als Markdown & CSV oder HTML (mit Unterseiten). Die IDs in Dateinamen werden entfernt, Checkboxen, Callouts und Toggle-Blöcke abgebildet. Datenbanken (CSV) werden nicht importiert.",
  },
];

function flatten(nodes: TreeNode[], depth = 0): ParentOption[] {
  return nodes.flatMap((n) => [
    { id: n.id, title: n.title || "Untitled", depth },
    ...flatten(n.children, depth + 1),
  ]);
}

export default async function ImportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role } = await loadSpace(slug);
  if (!can(role, "managePages")) redirect(`/s/${slug}`);

  const pages = await prisma.page.findMany({
    where: { spaceId: space.id, deletedAt: null, isTemplate: false },
    select: { id: true, title: true, parentId: true, position: true },
  });
  const parents = flatten(buildTree(pages));

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Upload className="h-5 w-5 text-muted" />
        Importieren
      </h1>
      <p className="mt-1 text-sm text-muted">
        Bestehende Inhalte als Seiten in „{space.name}“ übernehmen.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {FORMATS.map(({ icon: Icon, title, text }) => (
          <div
            key={title}
            className="rounded-xl border border-line bg-surface p-4 shadow-soft"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon className="h-4 w-4" />
            </span>
            <h2 className="mt-3 text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              {text}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <ImportForm
          slug={slug}
          spaceId={space.id}
          parents={parents}
          maxMb={importMaxMb()}
        />
      </div>
    </div>
  );
}
