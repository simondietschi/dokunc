import { createServer, type Socket } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Versand über den echten nodemailer-Transport aus @dokunc/mail gegen
 * einen SMTP-Fänger im selben Prozess.
 *
 * mail.test.ts baut die Fehler von Hand nach (smtpFehler). Ob nodemailer
 * sie wirklich so meldet, zeigt erst ein Gespräch mit einem Server: Code
 * und Antwortcode entscheiden in isTransientMailError (Reset) und im
 * Dispatcher des Collab-Prozesses (nur 5xx ist dauerhaft), ob ein
 * Versand wiederholt wird. Dazu der Absender mit Anzeigename, den
 * fromAddress() baut: den zerlegt der Adressparser von nodemailer.
 */

/** Verhalten des Fängers, je Test gesetzt. */
type Verhalten = {
  /** Antwort auf RCPT TO. */
  rcpt: string;
  /** Verbindung annehmen und ohne Begrüssung wieder schliessen. */
  ohneGruss: boolean;
};

const verhalten: Verhalten = { rcpt: "", ohneGruss: false };
/** Befehlszeilen des Clients, ohne den Inhalt nach DATA. */
const befehle: string[] = [];
/** Angenommene Nachrichten, Zeilen ohne CRLF. */
const nachrichten: string[][] = [];
const offen = new Set<Socket>();

/**
 * Kleinster SMTP-Server, der für einen Versand reicht. EHLO nennt weder
 * STARTTLS noch AUTH: nodemailer bleibt damit im Klartext und meldet
 * sich nicht an, wie ohne SMTP_USERNAME.
 */
const faenger = createServer((socket) => {
  offen.add(socket);
  socket.on("close", () => offen.delete(socket));
  if (verhalten.ohneGruss) {
    socket.end();
    return;
  }
  const antworte = (zeile: string) => socket.write(`${zeile}\r\n`);
  let puffer = "";
  let inhalt: string[] | null = null;
  antworte("220 faenger.test ESMTP");
  socket.on("data", (stueck) => {
    puffer += stueck.toString("utf8");
    let ende: number;
    while ((ende = puffer.indexOf("\r\n")) >= 0) {
      const zeile = puffer.slice(0, ende);
      puffer = puffer.slice(ende + 2);
      if (inhalt) {
        if (zeile === ".") {
          nachrichten.push(inhalt);
          inhalt = null;
          antworte("250 2.0.0 angenommen");
        } else {
          inhalt.push(zeile);
        }
        continue;
      }
      befehle.push(zeile);
      const verb = zeile.slice(0, 4).toUpperCase();
      if (verb === "EHLO") antworte("250 faenger.test");
      else if (verb === "MAIL") antworte("250 2.1.0 ok");
      else if (verb === "RCPT") antworte(verhalten.rcpt);
      else if (verb === "DATA") {
        inhalt = [];
        antworte("354 weiter");
      } else if (verb === "QUIT") {
        antworte("221 2.0.0 tschuess");
        socket.end();
      } else antworte("502 5.5.2 unbekannt");
    }
  });
});

let mail: typeof import("@dokunc/mail");
let isTransientMailError: typeof import("./mail").isTransientMailError;

beforeAll(async () => {
  await new Promise<void>((bereit) =>
    faenger.listen(0, "127.0.0.1", () => bereit()),
  );
  const adresse = faenger.address();
  if (!adresse || typeof adresse === "string") throw new Error("kein Port");
  // Der Transport liest die Umgebung beim ersten Versand und behält ihn
  // für die Datei. Werte von aussen (.env, CI) dürfen nicht mitspielen.
  vi.stubEnv("SMTP_HOST", "127.0.0.1");
  vi.stubEnv("SMTP_PORT", String(adresse.port));
  vi.stubEnv("SMTP_SECURE", "false");
  vi.stubEnv("SMTP_USERNAME", undefined);
  vi.stubEnv("SMTP_PASSWORD", undefined);
  vi.stubEnv("MAIL_FROM_ADDRESS", undefined);
  vi.stubEnv("APP_URL", "https://wiki.example.org");
  mail = await import("@dokunc/mail");
  ({ isTransientMailError } = await import("./mail"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const socket of offen) socket.destroy();
  await new Promise((fertig) => faenger.close(fertig));
});

beforeEach(() => {
  verhalten.rcpt = "250 2.1.5 ok";
  verhalten.ohneGruss = false;
  befehle.length = 0;
  nachrichten.length = 0;
});

const MAIL = {
  to: "kim@example.org",
  subject: "Einladung zu „Handbuch“",
  text: "Hallo",
  html: "<p>Hallo</p>",
};

/** Der Fehler, mit dem sendMail scheitert. */
async function versandFehler(): Promise<{
  code?: unknown;
  responseCode?: unknown;
}> {
  const fehler = await mail.sendMail(MAIL).then(
    () => null,
    (e: unknown) => e,
  );
  expect(fehler).toBeInstanceOf(Error);
  return fehler as { code?: unknown; responseCode?: unknown };
}

describe("Versand über SMTP", () => {
  it("stellt mit dem Anzeigenamen als Absender zu", async () => {
    expect(await mail.sendMail(MAIL)).toBe(true);

    // Umschlag: nur die Adresse, der Anzeigename gehört in den Kopf.
    expect(befehle).toContain("MAIL FROM:<no-reply@wiki.example.org>");
    expect(befehle).toContain("RCPT TO:<kim@example.org>");
    expect(nachrichten).toHaveLength(1);
    const kopf = nachrichten[0].slice(0, nachrichten[0].indexOf(""));
    expect(kopf).toContain("From: dokunc <no-reply@wiki.example.org>");
    expect(kopf).toContain("To: kim@example.org");
  });

  it("meldet einen abgewiesenen Empfänger als dauerhaft", async () => {
    verhalten.rcpt = "550 5.1.1 <kim@example.org>: Recipient address rejected";
    const fehler = await versandFehler();
    expect(fehler).toMatchObject({ code: "EENVELOPE", responseCode: 550 });
    expect(isTransientMailError(fehler)).toBe(false);
  });

  it("meldet auch einen zurückgestellten Empfänger über den Umschlag", async () => {
    // Der Dispatcher versucht es wieder (kein 5xx), der Reset gibt den
    // Platz der Bremse nicht zurück (EENVELOPE).
    verhalten.rcpt = "450 4.2.1 Mailbox busy";
    const fehler = await versandFehler();
    expect(fehler).toMatchObject({ code: "EENVELOPE", responseCode: 450 });
    expect(isTransientMailError(fehler)).toBe(false);
  });

  it("meldet eine Verbindung, die vor der Begrüssung endet, als vorübergehend", async () => {
    // Bis nodemailer 10.0.11 kam hier eine Sekunde später "Unexpected
    // socket close" ohne Code an, und das zählte als dauerhaft.
    verhalten.ohneGruss = true;
    const fehler = await versandFehler();
    expect(fehler).toMatchObject({ code: "ECONNECTION" });
    expect(fehler.responseCode).toBeUndefined();
    expect(isTransientMailError(fehler)).toBe(true);
  });
});
