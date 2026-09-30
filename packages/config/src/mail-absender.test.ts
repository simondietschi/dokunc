import { describe, expect, it } from "vitest";
import {
  effectiveSender,
  senderDomain,
  senderText,
  undeliverableDomain,
} from "./mail-absender";

describe("effectiveSender", () => {
  // Compose setzt MAIL_FROM_ADDRESS immer, leer als Vorgabe. Leer und nur
  // Leerraum zaehlen deshalb wie "nicht gesetzt", nicht als Absender.
  it.each([
    ["nicht gesetzt", undefined],
    ["leer", ""],
    ["nur Leerraum", "  "],
  ])("leitet den Absender aus APP_URL ab, wenn MAIL_FROM_ADDRESS %s ist", (_fall, wert) => {
    expect(
      effectiveSender({ MAIL_FROM_ADDRESS: wert, APP_URL: "https://wiki.firma.ch" }),
    ).toEqual({ name: "dokunc", address: "no-reply@wiki.firma.ch" });
  });

  it("nimmt den Anzeigenamen aus APP_NAME", () => {
    expect(effectiveSender({ APP_NAME: " Wiki der Firma, Bern ", APP_URL: "https://wiki.firma.ch" })).toEqual({
      name: "Wiki der Firma, Bern",
      address: "no-reply@wiki.firma.ch",
    });
    expect(effectiveSender({ APP_NAME: "  ", APP_URL: "https://wiki.firma.ch" })).toEqual({
      name: "dokunc",
      address: "no-reply@wiki.firma.ch",
    });
  });

  it("laesst einen eigenen Wert stehen, getrimmt", () => {
    expect(
      effectiveSender({ MAIL_FROM_ADDRESS: " Wiki <wiki@firma.ch> ", APP_URL: "https://x.ch" }),
    ).toBe("Wiki <wiki@firma.ch>");
  });

  it("nimmt ohne APP_URL localhost, wie appUrl()", () => {
    expect(effectiveSender({})).toEqual({ name: "dokunc", address: "no-reply@localhost" });
    expect(effectiveSender({ APP_URL: "" })).toEqual({ name: "dokunc", address: "no-reply@localhost" });
  });

  it("wirft bei unbrauchbarer APP_URL nicht, sondern nimmt localhost", () => {
    // Bisher warf new URL() beim Versand, und jede Mail scheiterte.
    for (const appUrl of ["wiki.firma.ch", "http://", "::"]) {
      expect(effectiveSender({ APP_URL: appUrl }), appUrl).toEqual({
        name: "dokunc",
        address: "no-reply@localhost",
      });
    }
  });

  it("nimmt den Host ohne Port und Pfad, klein geschrieben", () => {
    expect(effectiveSender({ APP_URL: "https://Wiki.Firma.CH:8443/wiki/" })).toEqual({
      name: "dokunc",
      address: "no-reply@wiki.firma.ch",
    });
  });
});

describe("senderText", () => {
  it("zeigt Name und Adresse wie im Kopf der Mail", () => {
    expect(senderText({ name: "dokunc", address: "no-reply@wiki.firma.ch" })).toBe(
      "dokunc <no-reply@wiki.firma.ch>",
    );
    expect(senderText("Wiki <wiki@firma.ch>")).toBe("Wiki <wiki@firma.ch>");
  });
});

describe("senderDomain", () => {
  it.each([
    ["Wiki <wiki@Firma.CH>", "firma.ch"],
    ["wiki@firma.ch", "firma.ch"],
    ['"a@b" <wiki@firma.ch >', "firma.ch"],
    [{ name: "dokunc", address: "no-reply@localhost" }, "localhost"],
    ["dokunc", null],
  ] as const)("%j -> %j", (absender, erwartet) => {
    expect(senderDomain(absender)).toBe(erwartet);
  });
});

describe("undeliverableDomain", () => {
  it.each([
    "example.com",
    "example.net",
    "example.org",
    "mail.example.com",
    "localhost",
    "wiki.localhost",
    "wiki.local",
    "firma.test",
    "firma.example",
    "firma.invalid",
    "10.0.0.5",
    "[::1]",
    "[ipv6:2001:db8::1]",
    "intranet",
    "",
  ])("%j ist nicht zustellbar", (domain) => {
    expect(undeliverableDomain(domain)).toBe(true);
  });

  it.each(["firma.ch", "wiki.firma.ch", "example.com.firma.ch", "notexample.com", "localhost.firma.ch"])(
    "%j ist zustellbar",
    (domain) => {
      expect(undeliverableDomain(domain)).toBe(false);
    },
  );
});
