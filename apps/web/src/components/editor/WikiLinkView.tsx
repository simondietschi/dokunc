"use client";

import Link from "next/link";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { FileText, Lock } from "lucide-react";
import { LABEL_OHNE_ZUGRIFF, LABEL_VERKNUEPFT } from "@/lib/link-labels";
import { useWikiLinkTitle } from "./WikiLinkTitles";

/**
 * Chip-Darstellung eines Wiki-Links; navigiert über /p/[pageId].
 *
 * Liest nie `node.attrs.label`: das ist der Titel beim Verlinken, und er
 * stünde sonst auch bei allen, die das Ziel inzwischen nicht mehr öffnen
 * dürfen. Angezeigt wird der aktuelle Titel aus dem Titelspeicher, den
 * der Server nur für sichtbare Ziele nennt; alle anderen Ziele, auch
 * gelöschte, heissen "Seite ohne Zugriff" und sind kein Link.
 */
export function WikiLinkView({ node }: NodeViewProps) {
  const pageId =
    typeof node.attrs.pageId === "string" ? node.attrs.pageId : null;
  const stand = useWikiLinkTitle(pageId);

  if (!pageId || stand.status === "gesperrt") {
    return (
      <NodeViewWrapper as="span" className="inline">
        <span
          className="dk-wikilink dk-wikilink-gesperrt"
          contentEditable={false}
          draggable={false}
        >
          <Lock className="dk-wikilink-icon" aria-hidden />
          {LABEL_OHNE_ZUGRIFF}
        </span>
      </NodeViewWrapper>
    );
  }

  const text =
    stand.status === "sichtbar"
      ? stand.title
      : stand.status === "laedt"
        ? "…"
        : LABEL_VERKNUEPFT;

  return (
    <NodeViewWrapper as="span" className="inline">
      <Link
        href={`/p/${pageId}`}
        className="dk-wikilink"
        contentEditable={false}
        draggable={false}
        aria-busy={stand.status === "laedt" || undefined}
        aria-label={stand.status === "laedt" ? "Verknüpfte Seite wird geladen" : undefined}
      >
        <FileText className="dk-wikilink-icon" aria-hidden />
        {text}
      </Link>
    </NodeViewWrapper>
  );
}
