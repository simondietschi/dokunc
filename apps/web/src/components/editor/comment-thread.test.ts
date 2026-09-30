import { describe, expect, it, vi } from "vitest";
import { getSchema, type Editor } from "@tiptap/core";
import { richExtensions } from "@dokunc/editor";

/**
 * Der Ankertext eines neuen Kommentars wird gespeichert und allen
 * gezeigt, die die Seite lesen. Umfasst die Markierung einen Wiki-Link,
 * kommt dessen gespeicherter Titel nicht hinein: das Label ist ein
 * Schnappschuss des Zieltitels (lib/link-labels).
 */

const gesendet = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/browser-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/browser-events")>()),
  sendBrowserEvent: (_name: string, detail: unknown) => gesendet.push(detail),
}));

const { startCommentThread } = await import("./comment-thread");

describe("startCommentThread", () => {
  it("nimmt den gespeicherten Titel eines Wiki-Links nicht in den Ankertext", () => {
    const doc = getSchema(richExtensions()).nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Siehe " },
            {
              type: "wikiLink",
              attrs: { pageId: "caaaaaaaaaaaaaaaaaaaaaaaa", label: "Kündigung M. Muster" },
            },
            { type: "text", text: " dort" },
          ],
        },
      ],
    });
    const run = vi.fn();
    const editor = {
      state: { doc, selection: { from: 1, to: doc.content.size - 1, empty: false } },
      chain: () => ({ focus: () => ({ setCommentMark: () => ({ run }) }) }),
    } as unknown as Editor;

    startCommentThread(editor);

    expect(run).toHaveBeenCalled();
    expect(gesendet).toHaveLength(1);
    const { anchorText } = gesendet[0] as { anchorText: string };
    expect(anchorText).toContain("Siehe");
    expect(anchorText).toContain("dort");
    expect(anchorText).not.toContain("Kündigung");
  });
});
