import { describe, it, expect } from "vitest";
import { extractWikiLinkIds, extractMentionIds } from "@dokunc/editor";

const doc = (content: unknown[]) => ({ type: "doc", content });

describe("extractWikiLinkIds()", () => {
  it("findet Wiki-Links auch verschachtelt", () => {
    const d = doc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Siehe " },
          { type: "wikiLink", attrs: { pageId: "p1", label: "Guide" } },
        ],
      },
      {
        type: "callout",
        attrs: { type: "info" },
        content: [
          {
            type: "paragraph",
            content: [
              { type: "wikiLink", attrs: { pageId: "p2", label: "FAQ" } },
            ],
          },
        ],
      },
    ]);
    expect(extractWikiLinkIds(d).sort()).toEqual(["p1", "p2"]);
  });

  it("dedupliziert und ignoriert kaputte Attrs", () => {
    const d = doc([
      {
        type: "paragraph",
        content: [
          { type: "wikiLink", attrs: { pageId: "p1", label: "A" } },
          { type: "wikiLink", attrs: { pageId: "p1", label: "A2" } },
          { type: "wikiLink", attrs: { pageId: null, label: "kaputt" } },
        ],
      },
    ]);
    expect(extractWikiLinkIds(d)).toEqual(["p1"]);
  });

  it("leeres/ungültiges Dokument -> leer", () => {
    expect(extractWikiLinkIds(null)).toEqual([]);
    expect(extractWikiLinkIds(doc([]))).toEqual([]);
  });
});

describe("extractMentionIds()", () => {
  it("findet Mentions", () => {
    const d = doc([
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { userId: "u1", name: "Alex" } },
          { type: "text", text: " bitte prüfen, " },
          { type: "mention", attrs: { userId: "u2", name: "Kim" } },
        ],
      },
    ]);
    expect(extractMentionIds(d).sort()).toEqual(["u1", "u2"]);
  });

  it("Mention-Diff-Basis: alte vs. neue IDs", () => {
    const before = doc([
      {
        type: "paragraph",
        content: [{ type: "mention", attrs: { userId: "u1", name: "A" } }],
      },
    ]);
    const after = doc([
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { userId: "u1", name: "A" } },
          { type: "mention", attrs: { userId: "u2", name: "B" } },
        ],
      },
    ]);
    const prev = new Set(extractMentionIds(before));
    const added = extractMentionIds(after).filter((id) => !prev.has(id));
    expect(added).toEqual(["u2"]);
  });
});
