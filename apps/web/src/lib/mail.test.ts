import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Transaktionale Mails ohne SMTP und die Einstufung von Versandfehlern.
 *
 * Der Transport ist ersetzt: `sendMail` liefert false wie ohne
 * SMTP_HOST. Alles andere aus @dokunc/mail bleibt echt.
 */

vi.mock("@dokunc/mail", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@dokunc/mail")>();
  return { ...orig, sendMail: vi.fn(async () => false) };
});

const { isTransientMailError, sendInvitationEmail, sendPasswordResetEmail } =
  await import("./mail");
const { log } = await import("./log");

const ADRESSE = "Kim.Muster@example.org";
const TOKEN = "geheimes-token-123";
const RESET_URL = `https://wiki.example.org/reset/reset-id-1?token=${TOKEN}`;
const INVITE_URL = `https://wiki.example.org/invite/einl-id-1?token=${TOKEN}`;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllEnvs();
});

/** Alles, was ins Log ging, als ein Text. */
function geloggt(): string {
  return JSON.stringify(warn.mock.calls);
}

describe("ohne SMTP in der Produktion", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  it("meldet den Reset-Link als nicht zugestellt", async () => {
    expect(
      await sendPasswordResetEmail({ to: ADRESSE, resetUrl: RESET_URL }),
    ).toBe(false);
  });

  it("schreibt weder Adresse noch Token ins Log, nur den Pfad", async () => {
    await sendPasswordResetEmail({ to: ADRESSE, resetUrl: RESET_URL });
    await sendInvitationEmail({
      to: ADRESSE,
      spaceName: "Handbuch",
      inviterName: "Alex",
      role: "EDITOR",
      inviteUrl: INVITE_URL,
    });

    expect(warn).toHaveBeenCalledTimes(2);
    // Die Zeile entsteht beim Reset nur fuer Konten, die es gibt: mit
    // Adresse waere das Log eine Liste ausprobierter Konten.
    expect(geloggt().toLowerCase()).not.toContain(ADRESSE.toLowerCase());
    expect(geloggt()).not.toContain(TOKEN);
    // Wiederfinden laesst sich der Eintrag ueber seine Kennung im Pfad.
    expect(warn.mock.calls[0][0]).toEqual({ link: "/reset/reset-id-1" });
    expect(warn.mock.calls[1][0]).toEqual({ link: "/invite/einl-id-1" });
  });
});

describe("ohne SMTP ausserhalb der Produktion", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  it("legt den Link ins Log und meldet ihn damit als angekommen", async () => {
    expect(
      await sendPasswordResetEmail({ to: ADRESSE, resetUrl: RESET_URL }),
    ).toBe(true);
    // Die Entwicklung braucht den Link, um weiterzukommen — die Adresse
    // nicht.
    expect(warn.mock.calls[0][0]).toEqual({ url: RESET_URL });
    expect(geloggt().toLowerCase()).not.toContain(ADRESSE.toLowerCase());
  });

  it("gilt auch für Einladungen", async () => {
    expect(
      await sendInvitationEmail({
        to: ADRESSE,
        spaceName: "Handbuch",
        inviterName: "Alex",
        role: "EDITOR",
        inviteUrl: INVITE_URL,
      }),
    ).toBe(true);
    expect(warn.mock.calls[0][0]).toEqual({ url: INVITE_URL });
  });
});

/** Fehler in der Form, in der nodemailer sie wirft. */
function smtpFehler(felder: Record<string, unknown>): Error {
  return Object.assign(new Error("Versand gescheitert"), felder);
}

describe("isTransientMailError", () => {
  it("Verbindungsfehler ohne Serverantwort sind vorübergehend", () => {
    for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET"]) {
      expect(isTransientMailError(smtpFehler({ code }))).toBe(true);
    }
  });

  it("4xx heisst: später noch einmal", () => {
    expect(
      isTransientMailError(
        smtpFehler({ code: "EPROTOCOL", responseCode: 421 }),
      ),
    ).toBe(true);
    expect(
      isTransientMailError(smtpFehler({ code: "EMESSAGE", responseCode: 451 })),
    ).toBe(true);
  });

  it("5xx ist dauerhaft, auch bei einem Verbindungscode", () => {
    expect(
      isTransientMailError(smtpFehler({ code: "EMESSAGE", responseCode: 554 })),
    ).toBe(false);
    expect(
      isTransientMailError(smtpFehler({ code: "EAUTH", responseCode: 535 })),
    ).toBe(false);
    expect(
      isTransientMailError(
        smtpFehler({ code: "ECONNECTION", responseCode: 550 }),
      ),
    ).toBe(false);
  });

  it("ein abgewiesener Empfänger zählt nie als vorübergehend", () => {
    // Auch nicht mit 4xx: das haengt an der Adresse und vergeht fuer
    // sie nicht von selbst.
    expect(
      isTransientMailError(
        smtpFehler({ code: "EENVELOPE", responseCode: 550 }),
      ),
    ).toBe(false);
    expect(
      isTransientMailError(
        smtpFehler({ code: "EENVELOPE", responseCode: 450 }),
      ),
    ).toBe(false);
    expect(isTransientMailError(smtpFehler({ code: "EENVELOPE" }))).toBe(
      false,
    );
  });

  it("Unbekanntes zählt als dauerhaft", () => {
    expect(isTransientMailError(new Error("irgendwas"))).toBe(false);
    expect(isTransientMailError(smtpFehler({ code: "EAUTH" }))).toBe(false);
    expect(isTransientMailError("ECONNECTION")).toBe(false);
    expect(isTransientMailError(null)).toBe(false);
    expect(isTransientMailError(undefined)).toBe(false);
  });
});
