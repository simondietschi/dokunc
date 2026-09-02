"use client";

import { useEffect } from "react";
import { recordVisitAction } from "@/app/s/[slug]/actions";

/** Merkt sich den Seitenbesuch für "Zuletzt besucht" (einmal pro Aufruf). */
export function VisitTracker({ slug, pageId }: { slug: string; pageId: string }) {
  useEffect(() => {
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("pageId", pageId);
    void recordVisitAction(fd).catch(() => {});
  }, [slug, pageId]);
  return null;
}
