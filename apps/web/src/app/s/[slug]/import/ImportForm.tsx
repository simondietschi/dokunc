"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FileArchive,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Input";
import { ACCEPT_ATTRIBUTE } from "@/lib/import/limits";

export type ParentOption = { id: string; title: string; depth: number };

type ImportResponse = {
  pages: number;
  attachments: number;
  warnings: string[];
  roots: { id: string; title: string }[];
};

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "processing" }
  | { kind: "done"; result: ImportResponse }
  | { kind: "error"; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Upload per XMLHttpRequest (Fortschritt), Antwort als JSON. fetch()
 * liefert keinen Upload-Fortschritt — bei 100-MB-Zips ist der aber
 * die einzige Rueckmeldung.
 */
function upload(url: string, body: FormData, onProgress: (p: number) => void) {
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Netzwerkfehler"));
    xhr.onload = () => resolve({ status: xhr.status, json: xhr.response });
    xhr.send(body);
  });
}

export function ImportForm({
  slug,
  spaceId,
  parents,
  maxMb,
}: {
  slug: string;
  spaceId: string;
  parents: ParentOption[];
  maxMb: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [parentId, setParentId] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const tooBig = totalBytes > maxMb * 1024 * 1024;
  const busy = phase.kind === "uploading" || phase.kind === "processing";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0 || tooBig || busy) return;
    const body = new FormData();
    for (const f of files) body.append("files", f);
    body.set("parentId", parentId);
    setPhase({ kind: "uploading", percent: 0 });
    try {
      const res = await upload(`/api/spaces/${spaceId}/import`, body, (percent) =>
        setPhase(percent >= 100 ? { kind: "processing" } : { kind: "uploading", percent }),
      );
      const data = (res.json ?? {}) as Partial<ImportResponse> & { error?: string };
      if (res.status !== 200 || typeof data.pages !== "number") {
        setPhase({
          kind: "error",
          message: data.error ?? `Import fehlgeschlagen (HTTP ${res.status}).`,
        });
        return;
      }
      setPhase({ kind: "done", result: data as ImportResponse });
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setPhase({ kind: "error", message: "Upload fehlgeschlagen. Bitte erneut versuchen." });
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <div>
        <h2 className="text-sm font-semibold">Dateien hochladen</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          .md, .markdown, .txt, .html oder ein .zip — zusammen bis {maxMb} MB.
        </p>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-subtle/40 px-4 py-8 text-center transition-colors hover:border-accent/50">
        <FileArchive className="h-6 w-6 text-faint" />
        <span className="text-sm font-medium">
          {files.length === 0
            ? "Dateien auswählen"
            : `${files.length} ${files.length === 1 ? "Datei" : "Dateien"} ausgewählt`}
        </span>
        <span className="text-[12.5px] text-muted">
          {files.length === 0
            ? "Mehrere Dateien oder ein Zip möglich"
            : formatBytes(totalBytes)}
        </span>
        <input
          ref={inputRef}
          type="file"
          name="files"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            setPhase({ kind: "idle" });
          }}
        />
      </label>

      {files.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-[13px]">
          {files.map((f) => (
            <li
              key={`${f.name}-${f.size}`}
              className="flex items-center justify-between gap-3 rounded-md bg-subtle px-3 py-1.5"
            >
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-faint">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}

      <Field label="Ziel-Elternseite">
        <select
          name="parentId"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-soft"
        >
          <option value="">Oberste Ebene</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {`${"   ".repeat(p.depth)}${p.title}`}
            </option>
          ))}
        </select>
      </Field>

      {tooBig && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          Auswahl ist zu gross (max. {maxMb} MB).
        </p>
      )}

      {phase.kind === "uploading" && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[12.5px] text-muted">
            <span>Wird hochgeladen …</span>
            <span>{phase.percent} %</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${phase.percent}%` }}
            />
          </div>
        </div>
      )}
      {phase.kind === "processing" && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Seiten werden angelegt … Das kann bei grossen Exporten eine Weile dauern.
        </p>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {phase.message}
        </p>
      )}
      {phase.kind === "done" && <Result result={phase.result} slug={slug} />}

      <Button type="submit" disabled={files.length === 0 || tooBig || busy}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Upload className="h-4 w-4" />
            Import starten
          </>
        )}
      </Button>
    </form>
  );
}

function Result({ result, slug }: { result: ImportResponse; slug: string }) {
  return (
    <div
      role="status"
      className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
    >
      <p className="flex items-center gap-2 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4" />
        {result.pages} {result.pages === 1 ? "Seite" : "Seiten"} importiert
        {result.attachments > 0 &&
          `, ${result.attachments} ${result.attachments === 1 ? "Anhang" : "Anhänge"} gespeichert`}
        .
      </p>
      {result.roots.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {result.roots.map((r) => (
            <li key={r.id}>
              <Link
                href={`/s/${slug}/p/${r.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] font-medium text-ink transition-colors hover:border-accent/50"
              >
                {r.title}
                <ArrowUpRight className="h-3 w-3 text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <details className="text-[12.5px]">
          <summary className="flex cursor-pointer items-center gap-1.5 text-muted">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            {result.warnings.length}{" "}
            {result.warnings.length === 1 ? "Hinweis" : "Hinweise"}
          </summary>
          <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-muted">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
