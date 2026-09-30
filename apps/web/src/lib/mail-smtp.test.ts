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
 * fromAddress() baut: den zerlegt der Adressparser von nodemailer. Und
 * die Anmeldung mit SMTP_USERNAME an einem Server, der nur XOAUTH2
 * anbietet: bis nodemailer 10.0.10 warf sie einen TypeError, den kein
 * Aufrufer fangen konnte und der den Collab-Prozess beendete.
 */

/** Verhalten des Fängers, je Test gesetzt. */
type Verhalten = {
  /** Antwort auf RCPT TO. */
  rcpt: string;
  /** Verbindung annehmen und ohne Begrüssung wieder schliessen. */
  ohneGruss: boolean;
  /** Angebotene Anmeldeverfahren im EHLO, null: kein AUTH. */
  auth: string | null;
};

const verhalten: Verhalten = { rcpt: "", ohneGruss: false, auth: null };
/** Befehlszeilen des Clients, ohne den Inhalt nach DATA. */
const befehle: string[] = [];
/** Angenommene Nachrichten, Zeilen ohne CRLF. */
const nachrichten: string[][] = [];
const offen = new Set<Socket>();

/**
 * Kleinster SMTP-Server, der für einen Versand reicht. EHLO nennt kein
 * STARTTLS, nodemailer bleibt damit im Klartext. AUTH nennt es nur, wenn
 * ein Test verhalten.auth setzt; jede Anmeldung lehnt der Fänger dann ab
 * wie ein Server, der das gewählte Verfahren nicht kennt.
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
      if (verb === "EHLO") {
        if (verhalten.auth) {
          antworte("250-faenger.test");
          antworte(`250 AUTH ${verhalten.auth}`);
        } else antworte("250 faenger.test");
      } else if (verb === "AUTH") {
        antworte("504 5.7.4 Unrecognized authentication type");
      } else if (verb === "MAIL") antworte("250 2.1.0 ok");
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
  verhalten.auth = null;
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
async function versandFehler(modul = mail): Promise<{
  code?: unknown;
  responseCode?: unknown;
}> {
  const fehler = await modul.sendMail(MAIL).then(
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

describe("Anmeldung an einem Server, der nur XOAUTH2 anbietet", () => {
  let mitAnmeldung: typeof import("@dokunc/mail");

  beforeAll(async () => {
    // Der Transport der Tests oben ist ohne Zugangsdaten angelegt und
    // bleibt im Modul. resetModules lädt @dokunc/mail neu, der nächste
    // Versand legt einen Transport mit Anmeldung an.
    vi.stubEnv("SMTP_USERNAME", "wiki@example.org");
    vi.stubEnv("SMTP_PASSWORD", "geheim");
    vi.resetModules();
    mitAnmeldung = await import("@dokunc/mail");
  });

  it("scheitert sofort an der Anmeldung statt abzustürzen", async () => {
    // Bis nodemailer 10.0.10 wählte der Transport XOAUTH2 ohne
    // Token-Geber und warf "Cannot read properties of undefined (reading
    // 'getToken')" aus dem Socket-Handler: im Collab-Prozess ein
    // Absturz, in der Web-App hing der Versand bis zum Socket-Timeout
    // (30 s, länger als die Frist dieses Tests).
    verhalten.auth = "XOAUTH2";
    const fehler = await versandFehler(mitAnmeldung);
    expect(fehler).toMatchObject({ code: "EAUTH", responseCode: 504 });
    expect(befehle.some((b) => b.startsWith("AUTH PLAIN "))).toBe(true);
    expect(befehle.some((b) => b.startsWith("MAIL "))).toBe(false);
    // Dauerhaft: der Reset behält den Platz, der Dispatcher (5xx) gibt
    // die Zustellung auf, statt sie jeden Lauf zu wiederholen.
    expect(isTransientMailError(fehler)).toBe(false);
  });
});
