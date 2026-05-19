"use client";

import { useRef } from "react";
import Link from "next/link";
import { renamePageAction, deletePageAction } from "../../actions";

export function TitleBar({
  slug,
  pageId,
  title,
  canWrite,
  canManage,
}: {
  slug: string;
  pageId: string;
  title: string;
  canWrite: boolean;
  canManage: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex items-start justify-between gap-4 px-10 pt-8">
      <form ref={formRef} action={renamePageAction} className="flex-1">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="pageId" value={pageId} />
        <input
          name="title"
          defaultValue={title}
          readOnly={!canWrite}
          onBlur={() => canWrite && formRef.current?.requestSubmit()}
          className="w-full bg-transparent text-3xl font-bold outline-none"
          placeholder="Untitled"
        />
      </form>
      <div className="flex shrink-0 items-center gap-3 pt-2 text-sm">
        <Link
          href={`/s/${slug}/p/${pageId}/history`}
          className="text-slate-500 underline"
        >
          Verlauf
        </Link>
        {canManage && (
          <form action={deletePageAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="pageId" value={pageId} />
            <button className="text-red-500 underline">Löschen</button>
          </form>
        )}
      </div>
    </div>
  );
}
