"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ImportResult } from "@/app/api/spaces/[id]/import/route";

type PageOption = { id: string; title: string; icon: string | null };

export function ImportForm({
  slug,
  spaceId,
  pages,
}: {
  slug: string;
  spaceId: string;
  pages: PageOption[];
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const body = new FormData();
    for (const f of files) body.append("files", f);
    if (parentId) body.set("parentId", parentId);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/import`, {
        method: "POST",
        body,
      });
      const data = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Import fehlgeschlagen");
      setResult(data);
      setFiles([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <label className="block">
        <span className="text-[13px] font-medium">Dateien</span>
        <span className="block text-[12.5px] text-muted">
          Ein ZIP oder mehrere .md-Dateien
        </span>
        <input
          type="file"
          name="files"
          accept=".zip,.md,.markdown,application/zip,text/markdown"
          multiple
          required
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="mt-2 block w-full text-[13px] text-muted file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-canvas file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink hover:file:bg-subtle"
        />
      </label>

      <label className="block">
        <span className="text-[13px] font-medium">Einordnen unter</span>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="mt-2 block h-9 w-full rounded-lg border border-line-strong bg-canvas px-2.5 text-[13px] text-ink outline-none focus:border-accent/60"
        >
          <option value="">Oberste Ebene</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon ? `${p.icon} ` : ""}
              {p.title || "Untitled"}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}
      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[13px] text-emerald-700 dark:text-emerald-400">
          <p className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {result.pages} {result.pages === 1 ? "Seite" : "Seiten"} importiert
            {result.images > 0 && `, ${result.images} ${result.images === 1 ? "Bild" : "Bilder"}`}
          </p>
          {result.skipped.length > 0 && (
            <p className="mt-1 text-[12px] opacity-80">
              Übersprungen: {result.skipped.join(", ")}
            </p>
          )}
          {result.firstPageId && (
            <a
              href={`/s/${slug}/p/${result.firstPageId}`}
              className="mt-1.5 inline-block underline underline-offset-2"
            >
              Zur ersten importierten Seite
            </a>
          )}
        </div>
      )}

      <Button type="submit" disabled={busy || files.length === 0}>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Importiere…
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" /> Importieren
          </>
        )}
      </Button>
    </form>
  );
}
