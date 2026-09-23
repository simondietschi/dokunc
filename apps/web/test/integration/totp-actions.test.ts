import bcrypt from "bcryptjs";
import { Redis } from "ioredis";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";
import { RECOVERY_CODE_CONFIRM_MS, consumeRecoveryCode } from "@/lib/totp-store";
import { totpAt } from "@/lib/totp";
import type { TotpState } from "@/app/account/totp-actions";

/**
 * Der Ablauf des zweiten Faktors an den Actions selbst.
 *
 * totp.test.ts prueft die Bausteine in lib/totp-store. Hier geht es um
 * die Verdrahtung: dass die Einrichtung erst mit einem bestaetigten
 * Wiederherstellungscode scharf schaltet, ein Abbruch davor nichts
 * zuruecklaesst und beim Erneuern die alten Codes bis zur Bestaetigung
 * gelten. Wie in page-actions.test.ts laeuft die echte Action gegen die
 * echte Datenbank; ersetzt sind nur Anmeldung, Anfrage-Header und Cache.
 */

type Actor = { id: string; email: string; name: string; isAdmin: boolean };

/** Was der Schritt in der Transaktion vom Transaktions-Client braucht. */
type TxRaw = {
  $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T>;
};

const mocks = vi.hoisted(() => ({
  actor: null as Actor | null,
  /**
   * Ein Schritt vor der naechsten Transaktion, einmalig: so trifft ein
   * zweiter Tab verlaesslich die Luecke zwischen Pruefen und Schreiben.
   */
  beforeTransaction: null as null | (() => Promise<unknown>),
  /**
   * Ein Schritt MITTEN in der naechsten Transaktion, einmalig: direkt
   * bevor sie die Nutzerzeile schreibt (`tx.user.updateMany`). Bis dahin
   * haelt sie alle Sperren, die sie vorher genommen hat — genau dort
   * laesst sich ein zweiter Tab gegen diese Sperren laufen lassen.
   */
  beforeTxUserUpdate: null as null | ((tx: TxRaw) => Promise<unknown>),
  /**
   * Wie `beforeTxUserUpdate`, nur direkt bevor die naechste Transaktion
   * neue Codes einfuegt (`tx.totpRecoveryCode.createMany`). Den bis dahin
   * wartenden Satz hat sie da schon geloescht und haelt dessen Zeilen.
   */
  beforeTxCodesCreate: null as null | ((tx: TxRaw) => Promise<unknown>),
}));

/** Welche Methode des Transaktions-Clients welchen Schritt abwartet. */
const TX_HOOKS = {
  user: { method: "updateMany", step: "beforeTxUserUpdate" },
  totpRecoveryCode: { method: "createMany", step: "beforeTxCodesCreate" },
} as const;

/**
 * Transaktions-Client, dessen `user.updateMany` bzw.
 * `totpRecoveryCode.createMany` einmalig erst den Schritt aus `mocks`
 * abwartet (siehe `TX_HOOKS`). Alles andere geht unveraendert an den
 * echten Client.
 */
function withTxHooks<T extends object>(tx: T): T {
  const bind = (obj: object, key: PropertyKey) => {
    const v = Reflect.get(obj, key);
    return typeof v === "function" ? v.bind(obj) : v;
  };
  return new Proxy(tx, {
    get(target, prop) {
      if (!Object.hasOwn(TX_HOOKS, prop)) return bind(target, prop);
      const hook = TX_HOOKS[prop as keyof typeof TX_HOOKS];
      const delegate = Reflect.get(target, prop) as object;
      return new Proxy(delegate, {
        get(d, method) {
          const step = mocks[hook.step];
          if (method !== hook.method || !step) return bind(d, method);
          mocks[hook.step] = null;
          const run = bind(d, method) as (...a: unknown[]) => unknown;
          return async (...args: unknown[]) => {
            await step(target as unknown as TxRaw);
            return run(...args);
          };
        },
      });
    },
  });
}

vi.mock("@dokunc/db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@dokunc/db")>();
  const prisma = new Proxy(orig.prisma, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "$transaction") return value;
      const step = mocks.beforeTransaction;
      const hooked =
        mocks.beforeTxUserUpdate !== null || mocks.beforeTxCodesCreate !== null;
      if (!step && !hooked) return value;
      mocks.beforeTransaction = null;
      const run = value as (...a: unknown[]) => unknown;
      return async (arg: unknown, ...rest: unknown[]) => {
        if (step) await step();
        if (!hooked || typeof arg !== "function") {
          return run.call(target, arg, ...rest);
        }
        return run.call(
          target,
          (tx: object) => (arg as (t: object) => unknown)(withTxHooks(tx)),
          ...rest,
        );
      };
    },
  });
  return { ...orig, prisma };
});

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => mocks.actor),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const {
  cancelTotpSetupAction,
  confirmRecoveryCodesAction,
  confirmTotpAction,
  disableTotpAction,
  discardRecoveryCodesAction,
  regenerateRecoveryCodesAction,
  startTotpSetupAction,
} = await import("@/app/account/totp-actions");
const { ConfirmCodes } = await import("@/app/account/TwoFactorForm");

const TAG = `totpact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORT = "richtig-und-lang";
const created: string[] = [];

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

function formular(felder: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

/** Frisches Konto ohne zweiten Faktor, als angemeldete Person gesetzt. */
async function anmelden(name: string): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${name}@example.test`,
      name,
      passwordHash: await bcrypt.hash(PASSWORT, 4),
    },
    select: { id: true, email: true, name: true },
  });
  created.push(user.id);
  mocks.actor = { ...user, isAdmin: false };
  return mocks.actor;
}

/**
 * Die versteckten Felder, die das Bestaetigungsformular der Seite
 * mitschickt: aus der echten Komponente gerendert, nicht nachgebaut.
 * `renewing` ist die Ansicht, in der die Liste steht — Codes erneuern
 * (Knopf „Verwerfen“) oder Einrichtung (Knopf „Abbrechen“).
 */
function ansicht(renewing: boolean): Record<string, string> {
  const html = renderToStaticMarkup(
    createElement(ConfirmCodes, {
      pending: { codes: [], minutes: 30 },
      renewing,
      onConfirmed: () => {},
      onCancel: () => {},
    }),
  );
  const felder: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    const attr = Object.fromEntries(
      [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
    );
    if (attr.type === "hidden" && attr.name) {
      felder[attr.name] = attr.value ?? "";
    }
  }
  return felder;
}
/** Die beiden Ansichten, lesbarer als `true` und `false`. */
const ERNEUERN = true;
const EINRICHTUNG = false;

async function zustand(id: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id },
    select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true },
  });
}

/** Einrichtung bis zu den ausgegebenen, noch unbestaetigten Codes. */
async function bisZuDenCodes(): Promise<string[]> {
  const start = await startTotpSetupAction(undefined, formular({}));
  const secret = start?.setup?.grouped.replace(/\s+/g, "") ?? "";
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const code = totpAt(secret, Math.floor(Date.now() / 1000));
  const next = await confirmTotpAction(undefined, formular({ code }));
  expect(next?.error).toBeUndefined();
  expect(next?.recoveryCodes).toHaveLength(10);
  return next?.recoveryCodes ?? [];
}

/** Konto mit fertig eingerichtetem zweitem Faktor. */
async function eingerichtet(name: string): Promise<{
  actor: Actor;
  codes: string[];
}> {
  const actor = await anmelden(name);
  const codes = await bisZuDenCodes();
  const done = await confirmRecoveryCodesAction(
    undefined,
    formular({ code: codes[0] }),
  );
  expect(done?.confirmed).toBe(true);
  return { actor, codes };
}

async function aktiveCodes(userId: string): Promise<number> {
  return prisma.totpRecoveryCode.count({
    where: { userId, usedAt: null, pendingUntil: null },
  });
}

/**
 * Die Meldungen woertlich. Sie sollen sagen, wie es weitergeht; ein
 * blosses "irgendein Fehler" verdeckte genau die Faelle, in denen die
 * Person einen richtigen Code abtippt und trotzdem abgewiesen wird.
 */
const MELDUNG = {
  falsch:
    "Das ist keiner der Codes, die auf Bestätigung warten. Tippe einen " +
    "aus der Liste oben ab. Passt er trotzdem nicht, wurden inzwischen " +
    "in einem anderen Fenster neue Codes erzeugt, und diese Liste gilt " +
    "nicht mehr — lade dann die Seite neu.",
  schonAktiv:
    "Dieser Code gilt bereits — es wartet nichts mehr auf Bestätigung.",
  listeWeg:
    "Diese Liste wartet nicht mehr auf Bestätigung: sie wurde verworfen " +
    "oder schon bestätigt. Vertippt? Dann gib den Code noch einmal ein. " +
    "Sonst gelten die bisherigen Codes weiter — über „Verwerfen“ kannst " +
    "du bei Bedarf neue erzeugen.",
  einrichtungWeg:
    "Diese Codes gelten nicht mehr: die Einrichtung wurde inzwischen " +
    "abgebrochen oder in einem anderen Fenster neu begonnen. Über " +
    "„Abbrechen“ lässt sich hier neu beginnen.",
  fristErneuern:
    "Die Frist für diese Codes ist abgelaufen. Die bisherigen Codes " +
    "gelten weiter. Über „Verwerfen“ kommst du zurück und kannst bei " +
    "Bedarf neue erzeugen.",
  fristEinrichtung:
    "Die Frist für diese Codes ist abgelaufen. Über „Abbrechen“ lässt " +
    "sich die Einrichtung neu beginnen.",
  ueberholt:
    "Die Codes wurden eben in einem anderen Fenster geändert. Lade die " +
    "Seite neu, um den aktuellen Stand zu sehen.",
  anderesFenster:
    "Der zweite Faktor wurde inzwischen eingerichtet oder abgeschaltet " +
    "(etwa in einem anderen Fenster). Lade die Seite neu.",
};

let redis: Redis;
beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 1,
  });
});
afterAll(() => {
  redis.disconnect();
});

/** Stand der Bremse fuer die Bestaetigung der Codes (null: kein Zaehler). */
async function codeBremse(userId: string): Promise<string | null> {
  return redis.get(`dokunc:rl:totp:codes:${userId}`);
}

describe("Einrichtung", () => {
  it("schaltet erst scharf, wenn einer der Codes bestätigt ist", async () => {
    const actor = await anmelden("setup");
    const start = await startTotpSetupAction(undefined, formular({}));
    const secret = start?.setup?.grouped.replace(/\s+/g, "") ?? "";

    const falsch = await confirmTotpAction(
      undefined,
      formular({ code: "000000" }),
    );
    expect(falsch?.error).toMatch(/Code stimmt nicht/);

    const code = totpAt(secret, Math.floor(Date.now() / 1000));
    const next = await confirmTotpAction(undefined, formular({ code }));
    const codes = next?.recoveryCodes ?? [];
    expect(codes).toHaveLength(10);
    expect(next?.confirmMinutes).toBe(RECOVERY_CODE_CONFIRM_MS / 60_000);

    // Der Kern des Befunds: die Codes sind ausgegeben, die Antwort
    // koennte verloren gehen — der Faktor darf jetzt noch NICHT gelten.
    expect((await zustand(actor.id)).totpEnabledAt).toBeNull();
    expect(await aktiveCodes(actor.id)).toBe(0);

    const verkehrt = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: "0000000000-0000000000" }),
    );
    expect(verkehrt).toEqual({ error: MELDUNG.falsch });
    expect((await zustand(actor.id)).totpEnabledAt).toBeNull();

    const fertig = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: codes[3] }),
    );
    expect(fertig).toEqual({ success: "Zwei-Faktor ist aktiv.", confirmed: true });
    expect((await zustand(actor.id)).totpEnabledAt).not.toBeNull();
    expect(await aktiveCodes(actor.id)).toBe(10);
    expect(
      await prisma.auditLog.count({
        where: { actorId: actor.id, action: "auth.totp_enabled" },
      }),
    ).toBe(1);
  });

  it("ein Abbruch vor der Bestätigung lässt nichts Scharfes zurück", async () => {
    const actor = await anmelden("cancel");
    const codes = await bisZuDenCodes();

    await cancelTotpSetupAction();

    expect(await zustand(actor.id)).toEqual({
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
    });
    expect(
      await prisma.totpRecoveryCode.count({ where: { userId: actor.id } }),
    ).toBe(0);
    // Der Code steht auf der Liste, die der alte Tab noch zeigt. "Keiner
    // der Codes" schickte die Person ins Leere; die Meldung muss sagen,
    // dass die Einrichtung weg ist und wie es neu losgeht.
    const spaet = await confirmRecoveryCodesAction(
      undefined,
      formular({ ...ansicht(EINRICHTUNG), code: codes[0] }),
    );
    expect(spaet).toEqual({ error: MELDUNG.einrichtungWeg });
    // Eine Seite, die noch vor dem Feld `mode` geladen wurde, schickt
    // keinen Modus mit: dann zaehlt der Stand der Datenbank, und der ist
    // hier "nicht aktiv".
    const ohneModus = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: codes[0] }),
    );
    expect(ohneModus).toEqual({ error: MELDUNG.einrichtungWeg });
    expect((await zustand(actor.id)).totpEnabledAt).toBeNull();
  });

  it("ein neuer Anlauf verwirft die Codes des vorigen", async () => {
    const actor = await anmelden("restart");
    const alt = await bisZuDenCodes();

    await startTotpSetupAction(undefined, formular({}));

    // Die Codes gehoerten zum vorigen Geheimnis; ihre Bestaetigung
    // duerfte das neue, ungepruefte nicht scharf schalten.
    expect(
      await prisma.totpRecoveryCode.count({ where: { userId: actor.id } }),
    ).toBe(0);
    const res = await confirmRecoveryCodesAction(
      undefined,
      formular({ ...ansicht(EINRICHTUNG), code: alt[0] }),
    );
    expect(res).toEqual({ error: MELDUNG.einrichtungWeg });
    expect((await zustand(actor.id)).totpEnabledAt).toBeNull();
  });

  it("ist der neue Anlauf schon bei seinen Codes, gilt die alte Liste nicht", async () => {
    const actor = await anmelden("restart-codes");
    const alt = await bisZuDenCodes();
    // Ein anderer Tab beginnt neu und kommt bis zu eigenen Codes. Dann
    // wartet wieder ein Satz — nur nicht der, den der alte Tab zeigt.
    const neu = await bisZuDenCodes();

    const res = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: alt[0] }),
    );
    expect(res).toEqual({ error: MELDUNG.falsch });
    expect((await zustand(actor.id)).totpEnabledAt).toBeNull();

    const ok = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: neu[0] }),
    );
    expect(ok).toEqual({ success: "Zwei-Faktor ist aktiv.", confirmed: true });
  });

  it("schliesst ein anderer Tab die Einrichtung ab, heisst es neu laden", async () => {
    const actor = await anmelden("setup-elsewhere");
    // Tab A zeigt seine Liste, daneben „Abbrechen“.
    const tabA = await bisZuDenCodes();
    // Tab B beginnt neu, kommt zu eigenen Codes und bestaetigt einen.
    const tabB = await bisZuDenCodes();
    const fertig = await confirmRecoveryCodesAction(
      undefined,
      formular({ ...ansicht(EINRICHTUNG), code: tabB[0] }),
    );
    expect(fertig).toEqual({ success: "Zwei-Faktor ist aktiv.", confirmed: true });

    // Nach dem Stand der Datenbank allein hiesse es hier, die bisherigen
    // Codes gelten weiter und „Verwerfen“ helfe. Tab A hat weder
    // bisherige Codes noch diesen Knopf, und „Abbrechen“ fuehrt zu
    // „Einrichten“ und damit zu "Zwei-Faktor ist bereits aktiv.".
    const res = await confirmRecoveryCodesAction(
      undefined,
      formular({ ...ansicht(EINRICHTUNG), code: tabA[0] }),
    );
    expect(res).toEqual({ error: MELDUNG.anderesFenster });
    expect((await zustand(actor.id)).totpEnabledAt).not.toBeNull();
    expect(await aktiveCodes(actor.id)).toBe(10);
  });

  it("wer nach verlorener Antwort noch einmal bestätigt, hört: gilt schon", async () => {
    const actor = await anmelden("setup-retry");
    const codes = await bisZuDenCodes();
    const erste = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: codes[2] }),
    );
    expect(erste).toEqual({ success: "Zwei-Faktor ist aktiv.", confirmed: true });
    // Die erste Bestaetigung hat die Bremse geleert.
    expect(await codeBremse(actor.id)).toBeNull();

    // Die Antwort kam nie an; die Person schickt denselben Code noch
    // einmal — oder einen anderen von derselben Liste.
    const nochmal = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: codes[2] }),
    );
    expect(nochmal).toEqual({ success: MELDUNG.schonAktiv, confirmed: true });
    const andererCode = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: codes[7] }),
    );
    expect(andererCode).toEqual({
      success: MELDUNG.schonAktiv,
      confirmed: true,
    });

    // Nichts veraendert, kein zweiter Vermerk im Audit.
    expect(await aktiveCodes(actor.id)).toBe(10);
    expect(
      await prisma.auditLog.count({
        where: { actorId: actor.id, action: "auth.totp_enabled" },
      }),
    ).toBe(1);
    // Und die Bremse zaehlt weiter: ein bekannter Code darf den Zaehler
    // nicht leeren, sonst liessen sich damit beliebig viele Codes pruefen.
    expect(await codeBremse(actor.id)).toBe("2");
  });

  it("beginnt ein anderer Tab neu, gibt die Prüfung keine Codes aus", async () => {
    const actor = await anmelden("race-restart");
    const start = await startTotpSetupAction(undefined, formular({}));
    const secret = start?.setup?.grouped.replace(/\s+/g, "") ?? "";
    const code = totpAt(secret, Math.floor(Date.now() / 1000));
    // Zwischen dem Lesen des Geheimnisses und dem Ausgeben der Codes
    // startet ein anderer Tab die Einrichtung neu (neues Geheimnis).
    mocks.beforeTransaction = () =>
      startTotpSetupAction(undefined, formular({}));

    const res = await confirmTotpAction(undefined, formular({ code }));

    expect(res?.error).toMatch(/neu begonnen/);
    expect(res?.recoveryCodes).toBeUndefined();
    // Das neue Geheimnis ist ungeprueft: kein Zeitschritt, keine Codes.
    // Sonst schaltete die Bestaetigung ein Geheimnis scharf, das in
    // keiner App steht.
    expect((await zustand(actor.id)).totpLastStep).toBeNull();
    expect(
      await prisma.totpRecoveryCode.count({ where: { userId: actor.id } }),
    ).toBe(0);
  });

  it("wird die Einrichtung währenddessen fertig, überschreibt ein Start nichts", async () => {
    const actor = await anmelden("race-start");
    await bisZuDenCodes();
    const vorher = await zustand(actor.id);
    // Zwischen der Pruefung "noch nicht aktiv" und dem Schreiben des
    // neuen Geheimnisses schliesst ein anderer Tab die Einrichtung ab.
    mocks.beforeTransaction = () =>
      prisma.user.update({
        where: { id: actor.id },
        data: { totpEnabledAt: new Date() },
      });

    const res = await startTotpSetupAction(undefined, formular({}));

    expect(res?.error).toBe("Zwei-Faktor ist bereits aktiv.");
    const nachher = await zustand(actor.id);
    expect(nachher.totpSecret).toBe(vorher.totpSecret);
    expect(nachher.totpEnabledAt).not.toBeNull();
  });

  it("nach Ablauf der Frist heisst es neu beginnen", async () => {
    await anmelden("setup-expired");
    const codes = await bisZuDenCodes();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + RECOVERY_CODE_CONFIRM_MS + 60_000);
      const res = await confirmRecoveryCodesAction(
        undefined,
        formular({ ...ansicht(EINRICHTUNG), code: codes[0] }),
      );
      expect(res).toEqual({ error: MELDUNG.fristEinrichtung });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Codes erneuern", () => {
  it("die alten gelten, bis einer der neuen bestätigt ist", async () => {
    const { actor, codes: alt } = await eingerichtet("renew");

    const falsch = await regenerateRecoveryCodesAction(
      undefined,
      formular({ password: "falsch" }),
    );
    expect(falsch?.error).toBe("Passwort ist falsch.");

    const res = await regenerateRecoveryCodesAction(
      undefined,
      formular({ password: PASSWORT }),
    );
    const neu = res?.recoveryCodes ?? [];
    expect(neu).toHaveLength(10);
    // Keine Erfolgsmeldung: noch hat sich nichts geaendert.
    expect(res?.success).toBeUndefined();

    // Unbestaetigt: der alte Satz traegt weiter, der neue loest nichts ein.
    expect(await consumeRecoveryCode(actor.id, alt[1])).toBe(true);
    expect(await consumeRecoveryCode(actor.id, neu[1])).toBe(false);
    expect(await aktiveCodes(actor.id)).toBe(9);

    // Ein alter Code bestaetigt den neuen Satz nicht.
    const alterCode = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: alt[2] }),
    );
    expect(alterCode).toEqual({ error: MELDUNG.falsch });
    expect(await aktiveCodes(actor.id)).toBe(9);

    const ok = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: neu[0] }),
    );
    expect(ok?.confirmed).toBe(true);
    expect(ok?.success).toMatch(/neuen Codes gelten ab jetzt/);
    expect(await consumeRecoveryCode(actor.id, alt[2])).toBe(false);
    expect(await aktiveCodes(actor.id)).toBe(10);
    expect(
      await prisma.auditLog.count({
        where: { actorId: actor.id, action: "auth.recovery_codes_renewed" },
      }),
    ).toBe(1);
  });

  it("verwerfen lässt den alten Satz unberührt", async () => {
    const { actor, codes: alt } = await eingerichtet("discard");
    const res = await regenerateRecoveryCodesAction(
      undefined,
      formular({ password: PASSWORT }),
    );
    const neu = res?.recoveryCodes ?? [];

    await discardRecoveryCodesAction();

    const spaet = await confirmRecoveryCodesAction(
      undefined,
      formular({ ...ansicht(ERNEUERN), code: neu[0] }),
    );
    expect(spaet).toEqual({ error: MELDUNG.listeWeg });
    // Ohne Modus (Seite von vor dem Feld) zaehlt der Stand der Datenbank,
    // hier "aktiv".
    const ohneModus = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: neu[0] }),
    );
    expect(ohneModus).toEqual({ error: MELDUNG.listeWeg });
    expect(await aktiveCodes(actor.id)).toBe(10);
    expect(await consumeRecoveryCode(actor.id, alt[5])).toBe(true);
  });

  it("schaltet ein anderer Tab den Faktor ab, heisst es neu laden", async () => {
    const { actor } = await eingerichtet("renew-disabled");
    // Tab A erneuert und zeigt die neue Liste, daneben „Verwerfen“.
    const neu =
      (
        await regenerateRecoveryCodesAction(
          undefined,
          formular({ password: PASSWORT }),
        )
      )?.recoveryCodes ?? [];
    expect(neu).toHaveLength(10);
    // Tab B schaltet den zweiten Faktor ab.
    const aus = await disableTotpAction(
      undefined,
      formular({ password: PASSWORT }),
    );
    expect(aus).toEqual({ success: "Zwei-Faktor ist abgeschaltet." });

    // Nach dem Stand der Datenbank allein hiesse es hier, die
    // Einrichtung sei abgebrochen worden und „Abbrechen“ helfe. Tab A
    // zeigt „Verwerfen“, und abgebrochen wurde keine Einrichtung.
    const res = await confirmRecoveryCodesAction(
      undefined,
      formular({ ...ansicht(ERNEUERN), code: neu[0] }),
    );
    expect(res).toEqual({ error: MELDUNG.anderesFenster });
    expect(await zustand(actor.id)).toEqual({
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
    });
  });

  it("ersetzt ein anderer Tab die Liste, gilt sie nicht mehr", async () => {
    const { actor, codes: alt } = await eingerichtet("renew-replaced");
    const tabA = await regenerateRecoveryCodesAction(
      undefined,
      formular({ password: PASSWORT }),
    );
    const tabB = await regenerateRecoveryCodesAction(
      undefined,
      formular({ password: PASSWORT }),
    );

    const res = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: tabA?.recoveryCodes?.[0] ?? "" }),
    );
    expect(res).toEqual({ error: MELDUNG.falsch });
    // Bis Tab B bestaetigt, gelten die bisherigen.
    expect(await consumeRecoveryCode(actor.id, alt[4])).toBe(true);

    const ok = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: tabB?.recoveryCodes?.[0] ?? "" }),
    );
    expect(ok?.confirmed).toBe(true);
  });

  it("nach verlorener Antwort gilt die Wiederholung als erledigt", async () => {
    const { actor } = await eingerichtet("renew-retry");
    const res = await regenerateRecoveryCodesAction(
      undefined,
      formular({ password: PASSWORT }),
    );
    const neu = res?.recoveryCodes ?? [];
    const erste = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: neu[0] }),
    );
    expect(erste?.success).toMatch(/neuen Codes gelten ab jetzt/);

    const nochmal = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: neu[0] }),
    );
    expect(nochmal).toEqual({ success: MELDUNG.schonAktiv, confirmed: true });
    expect(await aktiveCodes(actor.id)).toBe(10);
    expect(
      await prisma.auditLog.count({
        where: { actorId: actor.id, action: "auth.recovery_codes_renewed" },
      }),
    ).toBe(1);
  });

  it("ersetzt ein anderer Tab den Satz mitten in der Bestätigung, heisst es neu laden", async () => {
    const { actor, codes: alt } = await eingerichtet("renew-race");
    const res = await regenerateRecoveryCodesAction(
      undefined,
      formular({ password: PASSWORT }),
    );
    const neu = res?.recoveryCodes ?? [];
    // Zwischen dem Nachschlagen des Codes und dem Umschalten legt ein
    // anderer Tab einen neuen Satz an: der echte Wettlauf.
    mocks.beforeTransaction = () =>
      regenerateRecoveryCodesAction(undefined, formular({ password: PASSWORT }));

    const spaet = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: neu[0] }),
    );
    expect(spaet).toEqual({ error: MELDUNG.ueberholt });
    expect(await consumeRecoveryCode(actor.id, alt[3])).toBe(true);
  });

  it("nach Ablauf der Frist gelten die bisherigen weiter", async () => {
    const { actor, codes: alt } = await eingerichtet("renew-expired");
    const res = await regenerateRecoveryCodesAction(
      undefined,
      formular({ password: PASSWORT }),
    );
    const neu = res?.recoveryCodes ?? [];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + RECOVERY_CODE_CONFIRM_MS + 60_000);
      const spaet = await confirmRecoveryCodesAction(
        undefined,
        formular({ ...ansicht(ERNEUERN), code: neu[0] }),
      );
      // Der Knopf fuer neue Codes ist ausgeblendet, solange die Liste
      // dasteht; die Meldung muss sagen, wie man zurueckkommt.
      expect(spaet).toEqual({ error: MELDUNG.fristErneuern });
      // Auch hier richtet sich der Text nach der Ansicht und nicht allein
      // nach der Datenbank. Mit echten Seiten ist dieser Fall kaum zu
      // erreichen (der Satz haette einen Wechsel des Faktors nicht
      // ueberlebt); geprueft wird die Regel: passt die Ansicht nicht zum
      // Stand, nennt die Meldung keinen Knopf, sondern das Neuladen.
      const andereAnsicht = await confirmRecoveryCodesAction(
        undefined,
        formular({ ...ansicht(EINRICHTUNG), code: neu[0] }),
      );
      expect(andereAnsicht).toEqual({ error: MELDUNG.anderesFenster });
    } finally {
      vi.useRealTimers();
    }
    expect(await consumeRecoveryCode(actor.id, alt[1])).toBe(true);
  });
});

/**
 * Wartet, bis eine andere Verbindung auf eine Sperre der Verbindung
 * `pid` wartet. So laeuft der zweite Tab nachweislich gegen die Sperre,
 * statt dass der Test auf eine geschaetzte Pause setzt.
 */
async function blockiertVon(pid: number): Promise<void> {
  const bis = Date.now() + 5_000;
  while (Date.now() < bis) {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
    `;
    if (n > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("der zweite Tab kam nie an der Sperre an");
}

describe("Sperrreihenfolge", () => {
  it("Bestätigung und Neustart in zwei Tabs verklemmen sich nicht", async () => {
    const actor = await anmelden("lock-order");
    const codes = await bisZuDenCodes();
    const vorher = await zustand(actor.id);

    // Die Bestaetigung hat ihre Sperren genommen und will gleich die
    // Nutzerzeile schreiben. Genau jetzt beginnt ein anderer Tab die
    // Einrichtung neu: er schreibt die Nutzerzeile und will danach die
    // ausstehenden Codes verwerfen. Nehmen beide Wege die Zeilen in
    // verschiedener Reihenfolge, wartet jeder auf den anderen, und
    // Postgres bricht einen davon mit "deadlock detected" ab.
    let zweiterTab: Promise<PromiseSettledResult<unknown>> | undefined;
    mocks.beforeTxUserUpdate = async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid
      `;
      // Gleich abgefangen: wirft der zweite Tab, soll das im Vergleich
      // unten stehen und nicht als unbehandelter Fehler dazwischenfahren.
      zweiterTab = Promise.allSettled([
        startTotpSetupAction(undefined, formular({})),
      ]).then(([r]) => r);
      await blockiertVon(pid);
    };

    const [bestaetigung] = await Promise.allSettled([
      confirmRecoveryCodesAction(undefined, formular({ code: codes[0] })),
    ]);
    const neustart = await zweiterTab;

    expect(bestaetigung).toEqual({
      status: "fulfilled",
      value: { success: "Zwei-Faktor ist aktiv.", confirmed: true },
    });
    // Der zweite Tab wartet, bis die Bestaetigung durch ist, und sieht
    // dann den aktiven Faktor — statt mit einem Fehler abzubrechen.
    expect(neustart).toEqual({
      status: "fulfilled",
      value: { error: "Zwei-Faktor ist bereits aktiv." },
    });
    const nachher = await zustand(actor.id);
    expect(nachher.totpEnabledAt).not.toBeNull();
    expect(nachher.totpSecret).toBe(vorher.totpSecret);
    expect(await aktiveCodes(actor.id)).toBe(10);
  });

  it("Bestätigung und neue Codes in zwei Tabs verklemmen sich nicht", async () => {
    const { actor, codes: alt } = await eingerichtet("lock-regen");
    const liste =
      (
        await regenerateRecoveryCodesAction(
          undefined,
          formular({ password: PASSWORT }),
        )
      )?.recoveryCodes ?? [];
    expect(liste).toHaveLength(10);

    // Die Bestaetigung hat die Liste eben noch wartend gefunden, ihre
    // Transaktion beginnt gleich. Vorher erzeugt ein anderer Tab neue
    // Codes: er hat den wartenden Satz schon geloescht, haelt damit
    // dessen Zeilen und steht vor dem Einfuegen. Erst wenn die
    // Bestaetigung nachweislich auf diese Zeilen wartet, fuegt er ein —
    // und die Fremdschluesselpruefung dabei braucht FOR KEY SHARE auf der
    // Nutzerzeile. Haelt die Bestaetigung die Nutzerzeile mit FOR UPDATE,
    // wartet jeder auf den anderen, und Postgres bricht einen davon mit
    // "deadlock detected" ab.
    let zweiterTab: Promise<PromiseSettledResult<TotpState>> | undefined;
    mocks.beforeTransaction = async () => {
      let angekommen!: () => void;
      const amHaken = new Promise<void>((r) => (angekommen = r));
      mocks.beforeTxCodesCreate = async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        angekommen();
        await blockiertVon(pid);
      };
      zweiterTab = Promise.allSettled([
        regenerateRecoveryCodesAction(
          undefined,
          formular({ password: PASSWORT }),
        ),
      ]).then(([r]) => r);
      // Kommt der zweite Tab gar nicht erst am Haken an, soll der Test an
      // den Erwartungen unten scheitern und nicht bis zur Zeitgrenze haengen.
      await Promise.race([amHaken, zweiterTab]);
    };

    const [bestaetigung] = await Promise.allSettled([
      confirmRecoveryCodesAction(undefined, formular({ code: liste[0] })),
    ]);
    const neueCodes = await zweiterTab;

    // Die Bestaetigung findet ihren Satz danach nicht mehr und sagt das,
    // statt mit einem Fehler abzubrechen.
    expect(bestaetigung).toEqual({
      status: "fulfilled",
      value: { error: MELDUNG.ueberholt },
    });
    expect(neueCodes).toMatchObject({
      status: "fulfilled",
      value: { confirmMinutes: RECOVERY_CODE_CONFIRM_MS / 60_000 },
    });
    const neu =
      neueCodes?.status === "fulfilled"
        ? (neueCodes.value?.recoveryCodes ?? [])
        : [];
    expect(neu).toHaveLength(10);

    // Nichts halb geschehen: die bisherigen Codes gelten weiter, und der
    // Satz des zweiten Tabs laesst sich ganz normal bestaetigen.
    expect(await aktiveCodes(actor.id)).toBe(10);
    expect(await consumeRecoveryCode(actor.id, alt[6])).toBe(true);
    const ok = await confirmRecoveryCodesAction(
      undefined,
      formular({ code: neu[0] }),
    );
    expect(ok).toEqual({
      success: "Die neuen Codes gelten ab jetzt, die alten nicht mehr.",
      confirmed: true,
    });
  });
});
