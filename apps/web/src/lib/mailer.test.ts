import { describe, expect, it } from "vitest";
import { commentMail, escapeHtml, excerpt, mentionMail } from "@dokunc/mailer";

describe("excerpt", () => {
  it("lässt kurze Texte unangetastet", () => {
    expect(excerpt("Kurz und knapp")).toBe("Kurz und knapp");
  });

  it("normalisiert Leerraum", () => {
    expect(excerpt("a\n\n  b\tc")).toBe("a b c");
  });

  it("kürzt lange Texte mit Auslassungszeichen", () => {
    const out = excerpt("x".repeat(400), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("entschärft Sonderzeichen", () => {
    expect(escapeHtml('<b>"x"</b>')).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
  });
});

describe("Vorlagen", () => {
  it("baut eine Erwähnungs-Mail mit Link zur Seite", () => {
    const mail = mentionMail({
      to: "a@b.test",
      actorName: "Alex",
      pageTitle: "Runbook",
      pageId: "abc123",
      snippet: "Bitte hier schauen",
    });
    expect(mail.subject).toContain("Runbook");
    expect(mail.text).toContain("/p/abc123");
    expect(mail.html).toContain("Alex");
  });

  it("unterscheidet Kommentar und Antwort", () => {
    const comment = commentMail({
      to: "a@b.test",
      actorName: "Alex",
      pageTitle: "Runbook",
      pageId: "abc",
      body: "Frage dazu",
      isReply: false,
    });
    const reply = { ...comment };
    const asReply = commentMail({
      to: "a@b.test",
      actorName: "Alex",
      pageTitle: "Runbook",
      pageId: "abc",
      body: "Antwort",
      isReply: true,
    });
    expect(comment.subject.startsWith("Kommentar")).toBe(true);
    expect(asReply.subject.startsWith("Antwort")).toBe(true);
    expect(reply.subject).toBe(comment.subject);
  });

  it("entschärft fremde Namen in der HTML-Fassung", () => {
    const mail = mentionMail({
      to: "a@b.test",
      actorName: "Alex",
      pageTitle: "<script>alert(1)</script>",
      pageId: "abc",
      snippet: "<img onerror=x>",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
