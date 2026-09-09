"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { collapseCrumbs } from "@/lib/breadcrumbs";

export type Crumb = { id: string; title: string };

type Item = { key: string; href: string; title: string };

/**
 * Brotkrumen ueber dem Seitentitel: Space > Vorfahren > aktueller Titel.
 * Bei vielen Ebenen wird der Mittelteil zu "…" gekuerzt (Tooltip zeigt
 * die ausgeblendeten Titel, Klick klappt sie auf). Der aktuelle Titel
 * kommt live aus dem Titel-Eingabefeld.
 */
export function Breadcrumbs({
  slug,
  spaceName,
  ancestors,
  current,
}: {
  slug: string;
  spaceName: string;
  ancestors: Crumb[];
  current: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const items: Item[] = [
    { key: "space", href: `/s/${slug}`, title: spaceName },
    ...ancestors.map((a) => ({
      key: a.id,
      href: `/s/${slug}/p/${a.id}`,
      title: a.title || "Untitled",
    })),
  ];
  const slots = expanded
    ? items.map((item) => ({ kind: "item" as const, item }))
    : collapseCrumbs(items, 4);

  const separator = (
    <ChevronRight
      aria-hidden
      className="mx-0.5 h-3 w-3 shrink-0 text-faint"
    />
  );

  return (
    <nav aria-label="Brotkrumen" className="mb-3">
      <ol className="flex flex-wrap items-center gap-y-1 text-[12.5px] leading-5 text-muted">
        {slots.map((slot) => (
          <Fragment key={slot.kind === "item" ? slot.item.key : "ellipsis"}>
            <li className="flex min-w-0 items-center">
              {slot.kind === "item" ? (
                <Link
                  href={slot.item.href}
                  title={slot.item.title}
                  className="max-w-[180px] truncate rounded px-1 py-0.5 transition-colors hover:bg-subtle hover:text-ink"
                >
                  {slot.item.title}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  title={slot.hidden.map((h) => h.title).join(" › ")}
                  aria-label="Ausgeblendete Ebenen anzeigen"
                  className="rounded px-1 py-0.5 transition-colors hover:bg-subtle hover:text-ink"
                >
                  …
                </button>
              )}
            </li>
            <li aria-hidden className="flex items-center">
              {separator}
            </li>
          </Fragment>
        ))}
        <li className="flex min-w-0 items-center">
          <span
            aria-current="page"
            className="max-w-[260px] truncate px-1 py-0.5 font-medium text-ink"
          >
            {current.trim() || "Ohne Titel"}
          </span>
        </li>
      </ol>
    </nav>
  );
}
