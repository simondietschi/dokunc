import { describe, expect, it } from "vitest";
import {
  commentJumpFor,
  commentThreadAnchor,
  scrollBlockFor,
} from "./comment-anchor";

const UUID = "3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b";

describe("commentJumpFor", () => {
  it("erkennt einen Thread-Anker, mit und ohne #, auch prozentkodiert", () => {
    const threads = [{ id: UUID }, { id: "abc-def" }];
    expect(commentJumpFor(`#comment-thread-${UUID}`, threads)).toEqual({
      kind: "thread",
      threadId: UUID,
    });
    expect(commentJumpFor(`comment-thread-${UUID}`, threads)).toEqual({
      kind: "thread",
      threadId: UUID,
    });
    expect(commentJumpFor("#comment-thread-abc%2Ddef", threads)).toEqual({
      kind: "thread",
      threadId: "abc-def",
    });
  });

  it("meldet einen geloeschten Kommentar, auch wenn der Thread fehlt", () => {
    expect(commentJumpFor("#comment-deleted", [{ id: UUID }])).toEqual({
      kind: "gone",
    });
    // Zwischen Umleitung und Rendern geloescht: Anker ohne Thread.
    expect(commentJumpFor(`#comment-thread-${UUID}`, [{ id: "anderer" }])).toEqual({
      kind: "gone",
    });
    expect(commentJumpFor(`#comment-thread-${UUID}`, [])).toEqual({
      kind: "gone",
    });
  });

  const lang = "a".repeat(65);
  const kaputt = "%E0%A4%A";
  // Stuende ein Thread mit genau diesem Text in der Liste, darf die
  // Zeichenregel ihn trotzdem nicht durchlassen.
  const alleThreads = [
    { id: UUID },
    { id: 'a"b' },
    { id: "a b" },
    { id: lang },
    { id: kaputt },
  ];
  it.each([
    "",
    "#",
    "#einleitung",
    "#comment-thread-",
    "#comment-thread-a%22b",
    "#comment-thread-a b",
    `#comment-thread-${lang}`,
    `#comment-thread-${kaputt}`,
  ])("laesst den Anker %j liegen", (hash) => {
    expect(commentJumpFor(hash, alleThreads)).toBeNull();
  });

  it("nimmt IDs bis 64 Zeichen", () => {
    const id = "a".repeat(64);
    expect(commentJumpFor(`#comment-thread-${id}`, [{ id }])).toEqual({
      kind: "thread",
      threadId: id,
    });
  });

  it("liest den eigenen Anker wieder (Rundlauf)", () => {
    expect(commentThreadAnchor("x")).toBe("comment-thread-x");
    expect(commentJumpFor(`#${commentThreadAnchor(UUID)}`, [{ id: UUID }])).toEqual({
      kind: "thread",
      threadId: UUID,
    });
  });
});

describe("scrollBlockFor", () => {
  it("zeigt lange Ziele ab dem Anfang, kurze in der Mitte", () => {
    expect(scrollBlockFor(900, 800)).toBe("start");
    expect(scrollBlockFor(300, 800)).toBe("center");
    expect(scrollBlockFor(800, 800)).toBe("center");
  });
});
