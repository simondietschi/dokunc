import { describe, it, expect } from "vitest";
import {
  notificationMail,
  digestMail,
  describeNotification,
  notificationPath,
  type NotificationMailItem,
} from "@dokunc/mail";

const mention: NotificationMailItem = {
  type: "MENTION",
  actorName: "Kim Muster",
  pageTitle: "Onboarding",
  url: "http://localhost:3000/notifications/n-mention",
};
const reply: NotificationMailItem = {
  type: "COMMENT_REPLY",
  actorName: "Alex",
  pageTitle: "Deployment",
  url: "http://localhost:3000/notifications/n-reply",
  excerpt: "Passt so, danke!",
};
const updated: NotificationMailItem = {
  type: "PAGE_UPDATED",
  actorName: "Kim Muster",
  pageTitle: "Onboarding",
  url: "http://localhost:3000/notifications/n1",
};

describe("describeNotification()", () => {
  it("liefert deutsche Prädikate", () => {
    expect(describeNotification("MENTION")).toBe("hat dich erwähnt");
    expect(describeNotification("COMMENT")).toBe("hat kommentiert");
    expect(describeNotification("COMMENT_REPLY")).toBe(
      "hat auf deinen Kommentar geantwortet",
    );
    expect(describeNotification("PAGE_UPDATED")).toBe("hat bearbeitet");
  });
});

describe("notificationPath()", () => {
  it("fuehrt jede Meldung ueber /notifications/<id>", () => {
    // Die Route setzt sie gelesen und fuehrt zum Ziel (Thread, Vergleich,
    // Seite); fuer jeden Typ derselbe Weg, auch aus der Mail.
    for (const type of [
      "PAGE_UPDATED",
      "MENTION",
      "COMMENT",
      "COMMENT_REPLY",
    ] as const) {
      // Die ganze Meldung reicht hinein, wie beim Dispatcher: Typ und
      // Seite duerfen am Weg nichts aendern.
      const meldung = { id: "n1", type, pageId: "p1" };
      expect(notificationPath(meldung), type).toBe("/notifications/n1");
    }
  });
});

describe("notificationMail()", () => {
  it("Betreff bei einer Erwähnung", () => {
    const m = notificationMail({ recipientName: "Sam", items: [mention] });
    expect(m.subject).toBe("Kim Muster hat dich in Onboarding erwähnt");
    expect(m.text).toContain("Hallo Sam,");
    expect(m.text).toContain(mention.url);
    expect(m.html).toContain(`href="${mention.url}"`);
    expect(m.html).toContain("Seite öffnen");
  });

  it("Betreff bei einer Kommentar-Antwort inkl. Auszug", () => {
    const m = notificationMail({ recipientName: "Sam", items: [reply] });
    expect(m.subject).toBe("Alex hat auf deinen Kommentar geantwortet");
    expect(m.text).toContain("Passt so, danke!");
    expect(m.html).toContain("Passt so, danke!");
  });

  it("Betreff und Knopf bei einer Änderung", () => {
    const m = notificationMail({ recipientName: "Sam", items: [updated] });
    expect(m.subject).toBe("Kim Muster hat Onboarding bearbeitet");
    expect(m.html).toContain("Änderungen ansehen");
    expect(m.html).not.toContain("Seite öffnen");
    expect(m.html).toContain(`href="${updated.url}"`);
    expect(m.text).toContain("Kim Muster hat bearbeitet");
  });

  it("Betreff bei mehreren Einträgen zählt", () => {
    const m = notificationMail({
      recipientName: "Sam",
      items: [mention, reply],
    });
    expect(m.subject).toBe("2 neue Benachrichtigungen in dokunc");
    expect(m.html).not.toContain("Seite öffnen");
    expect(m.text).toContain(mention.url);
    expect(m.text).toContain(reply.url);
  });

  it("escaped Nutzertexte im HTML", () => {
    const m = notificationMail({
      recipientName: "<b>Sam</b>",
      items: [
        {
          type: "MENTION",
          actorName: "<script>alert(1)</script>",
          pageTitle: 'Seite "A" & B',
          url: "http://localhost:3000/p/x?a=1&b=2",
          excerpt: "<img src=x onerror=alert(1)>",
        },
      ],
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&quot;A&quot; &amp; B");
    expect(m.html).toContain("&lt;img");
    expect(m.html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
    expect(m.html).toContain('href="http://localhost:3000/p/x?a=1&amp;b=2"');
    // Der Betreff bleibt Klartext (kein HTML-Escaping in Headern).
    expect(m.subject).toContain("<script>");
  });

  it("kürzt lange Auszüge", () => {
    const m = notificationMail({
      recipientName: "Sam",
      items: [{ ...reply, excerpt: "x".repeat(500) }],
    });
    expect(m.text).not.toContain("x".repeat(300));
    expect(m.text).toContain("…");
  });
});

describe("digestMail()", () => {
  it("zählt im Betreff und listet alle Einträge", () => {
    const m = digestMail({
      recipientName: "Sam",
      items: [mention, reply],
      since: new Date("2026-09-02T06:00:00Z"),
    });
    expect(m.subject).toBe(
      "Deine tägliche Zusammenfassung: 2 neue Benachrichtigungen",
    );
    expect(m.text).toContain("Kim Muster hat dich erwähnt");
    expect(m.text).toContain("Alex hat auf deinen Kommentar geantwortet");
    expect(m.html).toContain("Tägliche Zusammenfassung");
    expect(m.html).toContain(`href="${reply.url}"`);
  });

  it("listet Erwähnung und Änderung mit ihren Links", () => {
    const m = digestMail({
      recipientName: "Sam",
      items: [mention, updated],
      since: new Date("2026-09-02T06:00:00Z"),
    });
    expect(m.text).toContain("Kim Muster hat dich erwähnt");
    expect(m.text).toContain("Kim Muster hat bearbeitet");
    expect(m.text).toContain(mention.url);
    expect(m.text).toContain(updated.url);
    expect(m.html).toContain(`href="${mention.url}"`);
    expect(m.html).toContain(`href="${updated.url}"`);
  });

  it("Singular bei einem Eintrag", () => {
    const m = digestMail({
      recipientName: "",
      items: [mention],
      since: new Date("2026-09-02T06:00:00Z"),
    });
    expect(m.subject).toBe(
      "Deine tägliche Zusammenfassung: 1 neue Benachrichtigung",
    );
    expect(m.text).toContain("Hallo,");
  });
});
