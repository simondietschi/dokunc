import { describe, expect, it } from "vitest";
import { notificationTargetPath } from "./notification-target";

describe("notificationTargetPath", () => {
  it("fuehrt eine Aenderung auf den Vergleich mit dem Stand davor", () => {
    expect(
      notificationTargetPath({
        type: "PAGE_UPDATED",
        slug: "team",
        pageId: "p1",
        baselineVersionId: "v0",
      }),
    ).toBe("/s/team/p/p1/history/v0?against=current");
  });

  it("fuehrt eine Aenderung ohne Vergleichsstand auf die Seite", () => {
    expect(
      notificationTargetPath({
        type: "PAGE_UPDATED",
        slug: "team",
        pageId: "p1",
        baselineVersionId: null,
      }),
    ).toBe("/s/team/p/p1");
  });

  it("fuehrt andere Meldungen immer auf die Seite", () => {
    expect(
      notificationTargetPath({
        type: "MENTION",
        slug: "team",
        pageId: "p1",
        baselineVersionId: "v0",
      }),
    ).toBe("/s/team/p/p1");
  });

  it("fuehrt Kommentar und Antwort auf den Thread", () => {
    for (const type of ["COMMENT", "COMMENT_REPLY"] as const) {
      expect(
        notificationTargetPath({
          type,
          slug: "team",
          pageId: "p1",
          baselineVersionId: null,
          comment: { threadId: "t1" },
        }),
      ).toBe("/s/team/p/p1#comment-thread-t1");
    }
  });

  it("zeigt einen geloeschten Kommentar mit eigenem Anker", () => {
    expect(
      notificationTargetPath({
        type: "COMMENT",
        slug: "team",
        pageId: "p1",
        baselineVersionId: null,
        comment: "gone",
      }),
    ).toBe("/s/team/p/p1#comment-deleted");
  });

  it("fuehrt eine Kommentarmeldung ohne Kommentar auf die Seite", () => {
    expect(
      notificationTargetPath({
        type: "COMMENT",
        slug: "team",
        pageId: "p1",
        baselineVersionId: null,
        comment: null,
      }),
    ).toBe("/s/team/p/p1");
    expect(
      notificationTargetPath({
        type: "COMMENT_REPLY",
        slug: "team",
        pageId: "p1",
        baselineVersionId: null,
      }),
    ).toBe("/s/team/p/p1");
  });

  it("gibt nur Kommentarmeldungen einen Anker", () => {
    expect(
      notificationTargetPath({
        type: "MENTION",
        slug: "team",
        pageId: "p1",
        baselineVersionId: null,
        comment: { threadId: "t1" },
      }),
    ).toBe("/s/team/p/p1");
    expect(
      notificationTargetPath({
        type: "PAGE_UPDATED",
        slug: "team",
        pageId: "p1",
        baselineVersionId: "v0",
        comment: { threadId: "t1" },
      }),
    ).toBe("/s/team/p/p1/history/v0?against=current");
  });
});
