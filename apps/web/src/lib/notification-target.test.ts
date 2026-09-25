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
});
