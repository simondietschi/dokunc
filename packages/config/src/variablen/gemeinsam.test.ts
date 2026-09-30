import { describe, expect, it } from "vitest";
import { ANZEIGE_FEHLGESCHLAGEN, maskedConfig } from "../maskieren";
import type { Umgebung } from "../variable";
import { GEMEINSAME_VARIABLEN } from "./gemeinsam";

/** Was das Startlog fuer MAIL_FROM_ADDRESS zeigt. */
function absenderImLog(env: Umgebung): unknown {
  const v = GEMEINSAME_VARIABLEN.find((x) => x.name === "MAIL_FROM_ADDRESS");
  if (!v) throw new Error("MAIL_FROM_ADDRESS fehlt");
  const ergebnis = v.parse(env.MAIL_FROM_ADDRESS, env);
  if (!ergebnis.ok) throw new Error(ergebnis.fehler);
  return maskedConfig([v], { MAIL_FROM_ADDRESS: ergebnis.wert }, env).MAIL_FROM_ADDRESS;
}

describe("MAIL_FROM_ADDRESS im Startlog", () => {
  // Wie fromAddress() in packages/mail: ohne Wert "dokunc <no-reply@HOST>"
  // mit dem Host aus APP_URL, sonst der Wert, wie er gesetzt ist.
  it.each([
    [{ APP_URL: "https://wiki.firma.ch/" }, "dokunc <no-reply@wiki.firma.ch>"],
    [{ APP_URL: "http://10.0.0.5:3000" }, "dokunc <no-reply@10.0.0.5>"],
    [{}, "dokunc <no-reply@localhost>"],
    [{ MAIL_FROM_ADDRESS: "Wiki <wiki@firma.ch>", APP_URL: "https://wiki.firma.ch" }, "Wiki <wiki@firma.ch>"],
  ])("zeigt fuer %j den wirksamen Absender %j", (env, erwartet) => {
    expect(absenderImLog(env)).toBe(erwartet);
  });

  it("zeigt einen leeren Wert als leer, wie ihn nodemailer bekommt", () => {
    expect(absenderImLog({ MAIL_FROM_ADDRESS: "", APP_URL: "https://wiki.firma.ch" })).toBeNull();
  });

  it("zeigt bei unbrauchbarer APP_URL, dass der Absender nicht zu bestimmen ist", () => {
    expect(absenderImLog({ APP_URL: "wiki.firma.ch" })).toBe(ANZEIGE_FEHLGESCHLAGEN);
  });
});
