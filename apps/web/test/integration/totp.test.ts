import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@dokunc/db";
import { hashToken } from "@/lib/invitations";
import { generateRecoveryCodes, normalizeRecoveryCode } from "@/lib/totp";
import {
  RECOVERY_CODE_CONFIRM_MS,
  claimTotpStep,
  confirmRecoveryCodes,
  consumeRecoveryCode,
  countActiveRecoveryCodes,
  discardPendingRecoveryCodes,
  issueRecoveryCodes,
} from "@/lib/totp-store";

/**
 * Die beiden Zusagen des zweiten Faktors, die nicht im Code stehen,
 * sondern in Abfragebedingungen: ein Zeitschritt gilt einmal, ein
 * Wiederherstellungscode gilt einmal. Beides gegen eine echte Datenbank
 * — ein Mock würde genau die Bedingung nachbauen, die zu prüfen ist.
 */

/**
 * Der Client bleibt echt. Nur fuer einen Test laesst sich vor die
 * naechste Transaktion ein Schritt schieben — so wie ein zweiter Tab,
 * der genau zwischen Suche und Umschalten einen neuen Satz anlegt.
 * Zeitlich trifft man diese Luecke sonst nicht verlaesslich.
 */
const hooks = vi.hoisted(() => ({
  beforeTransaction: null as null | (() => Promise<unknown>),
}));

vi.mock("@dokunc/db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@dokunc/db")>();
  const prisma = new Proxy(orig.prisma, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "$transaction" || !hooks.beforeTransaction) return value;
      const step = hooks.beforeTransaction;
      hooks.beforeTransaction = null;
      return async (...args: unknown[]) => {
        await step();
        return (value as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  return { ...orig, prisma };
});

const TAG = `totp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let userId: string;
let otherId: string;
/** Konten fuer einzelne Tests, am Ende gemeinsam weggeraeumt. */
const extra: string[] = [];

/**
 * Konto mit aktivem zweitem Faktor. Das Geheimnis ist ein Platzhalter:
 * die Tests hier pruefen Abfragebedingungen, nicht die Entschluesselung.
 */
async function enabledUser(name: string): Promise<string> {
  const { id } = await prisma.user.create({
    data: {
      email: `${TAG}-${name}@example.test`,
      name: `TOTP ${name}`,
      passwordHash: "x",
      totpSecret: "platzhalter",
      totpEnabledAt: new Date(),
      totpLastStep: 1,
    },
    select: { id: true },
  });
  return id;
}

/**
 * Konto mitten in der Einrichtung: Geheimnis gespeichert, noch nicht
 * scharf. `verified` sagt, ob der Code aus der App schon geprueft ist
 * (dann steht ein Zeitschritt da, siehe confirmTotpAction).
 */
async function setupUser(name: string, verified: boolean): Promise<string> {
  const { id } = await prisma.user.create({
    data: {
      email: `${TAG}-${name}@example.test`,
      name: `TOTP ${name}`,
      passwordHash: "x",
      totpSecret: "platzhalter",
      totpLastStep: verified ? 1 : null,
    },
    select: { id: true },
  });
  extra.push(id);
  return id;
}

/** Satz ausgeben und bestaetigen — erst dann loest er etwas ein. */
async function issueActive(id: string, count: number): Promise<string[]> {
  const codes = await issueRecoveryCodes(id, count);
  expect(await confirmRecoveryCodes(id, codes[0])).toBe("renewed");
  return codes;
}

/** Alle Zeilen eines Kontos, stabil sortiert fuer Vorher-nachher-Vergleiche. */
async function snapshot(id: string) {
  return prisma.totpRecoveryCode.findMany({
    where: { userId: id },
    select: { id: true, codeHash: true, usedAt: true, pendingUntil: true },
    orderBy: { id: "asc" },
  });
}

beforeAll(async () => {
  [userId, otherId] = await Promise.all([
    enabledUser("a"),
    enabledUser("b"),
  ]);
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherId, ...extra] } },
  });
});

describe("Zeitschritt", () => {
  it("nimmt denselben Schritt kein zweites Mal", async () => {
    const step = 60_000_000;
    expect(await claimTotpStep(userId, step)).toBe(true);
    expect(await claimTotpStep(userId, step)).toBe(false);
    // Auch ein älterer Schritt ist verbraucht: sonst liesse sich der
    // Vorgänger-Code aus demselben Fenster nachreichen.
    expect(await claimTotpStep(userId, step - 1)).toBe(false);
    expect(await claimTotpStep(userId, step + 1)).toBe(true);
  });

  it("gewinnt bei gleichzeitigen Versuchen genau einmal", async () => {
    const step = 70_000_000;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimTotpStep(userId, step)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("betrifft nur das eigene Konto", async () => {
    const step = 80_000_000;
    expect(await claimTotpStep(userId, step)).toBe(true);
    expect(await claimTotpStep(otherId, step)).toBe(true);
  });
});

describe("Wiederherstellungscodes", () => {
  it("legt nur Hashes ab, als ausstehender Satz mit Frist", async () => {
    const before = Date.now();
    const codes = await issueRecoveryCodes(userId, 4);
    expect(codes).toHaveLength(4);
    const rows = await prisma.totpRecoveryCode.findMany({
      where: { userId },
      select: { codeHash: true, usedAt: true, pendingUntil: true },
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.usedAt === null)).toBe(true);
    for (const code of codes) {
      expect(rows.some((r) => r.codeHash === code)).toBe(false);
      expect(rows.some((r) => r.codeHash.length === 64)).toBe(true);
    }
    // Ein Zeitstempel fuer den ganzen Satz, eine halbe Stunde voraus.
    const until = new Set(rows.map((r) => r.pendingUntil?.getTime()));
    expect(until.size).toBe(1);
    const [deadline] = [...until];
    expect(deadline).toBeGreaterThanOrEqual(before + RECOVERY_CODE_CONFIRM_MS);
    expect(deadline).toBeLessThanOrEqual(Date.now() + RECOVERY_CODE_CONFIRM_MS);
    await discardPendingRecoveryCodes(userId);
  });

  it("löst jeden Code genau einmal ein", async () => {
    const codes = await issueActive(userId, 3);
    expect(await consumeRecoveryCode(userId, codes[0])).toBe(true);
    expect(await consumeRecoveryCode(userId, codes[0])).toBe(false);
    // Die übrigen Codes bleiben gültig.
    expect(await consumeRecoveryCode(userId, codes[1])).toBe(true);
  });

  it("verzeiht Gross- und Trennzeichen beim Abtippen", async () => {
    const codes = await issueActive(userId, 2);
    const typed = codes[0].toUpperCase().replace("-", " ");
    expect(await consumeRecoveryCode(userId, typed)).toBe(true);
  });

  it("nimmt keinen fremden Code an", async () => {
    const [mine] = await issueActive(userId, 2);
    await issueActive(otherId, 2);
    expect(await consumeRecoveryCode(otherId, mine)).toBe(false);
    expect(await consumeRecoveryCode(userId, mine)).toBe(true);
  });

  it("gibt bei gleichzeitigem Einlösen nur einmal grünes Licht", async () => {
    const [code] = await issueActive(userId, 2);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeRecoveryCode(userId, code)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("wirft die alten Codes weg, sobald neue bestätigt sind", async () => {
    const first = await issueActive(userId, 3);
    const second = await issueActive(userId, 3);
    expect(await consumeRecoveryCode(userId, first[1])).toBe(false);
    expect(await consumeRecoveryCode(userId, second[1])).toBe(true);
    expect(
      await prisma.totpRecoveryCode.count({ where: { userId } }),
    ).toBe(3);
  });
});

/**
 * Neue Codes gelten erst, wenn die Person einen davon eingetippt hat.
 * Vorher ersetzte der neue Satz den alten sofort — kam die Antwort mit
 * dem Klartext nicht an, stand das Konto ohne brauchbaren Code da.
 */
describe("Bestätigung neuer Codes", () => {
  it("ein ausstehender Code löst nichts ein", async () => {
    const id = await enabledUser("pending");
    extra.push(id);
    const fresh = await issueRecoveryCodes(id, 3);
    expect(await consumeRecoveryCode(id, fresh[0])).toBe(false);
    expect(await countActiveRecoveryCodes(id)).toBe(0);
    // Der Versuch hat ihn auch nicht verbraucht: bestätigen geht noch.
    expect(await confirmRecoveryCodes(id, fresh[0])).toBe("renewed");
    expect(await consumeRecoveryCode(id, fresh[1])).toBe(true);
  });

  it("die alten Codes gelten bis zur Bestätigung weiter", async () => {
    const id = await enabledUser("old");
    extra.push(id);
    const old = await issueActive(id, 3);
    const fresh = await issueRecoveryCodes(id, 3);
    expect(await consumeRecoveryCode(id, old[1])).toBe(true);
    expect(await consumeRecoveryCode(id, fresh[1])).toBe(false);
    // Gezaehlt wird, was im Notfall hilft: die zwei alten, nicht die
    // drei ausstehenden.
    expect(await countActiveRecoveryCodes(id)).toBe(2);
  });

  it("die Bestätigung tauscht beide Sätze auf einmal", async () => {
    const id = await enabledUser("swap");
    extra.push(id);
    const old = await issueActive(id, 3);
    const fresh = await issueRecoveryCodes(id, 3);

    expect(await confirmRecoveryCodes(id, fresh[2])).toBe("renewed");

    const rows = await snapshot(id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.pendingUntil === null)).toBe(true);
    expect(await consumeRecoveryCode(id, old[1])).toBe(false);
    expect(await consumeRecoveryCode(id, fresh[1])).toBe(true);
    // Der Code, mit dem bestaetigt wurde, bleibt gueltig.
    expect(await consumeRecoveryCode(id, fresh[2])).toBe(true);
  });

  it("wird der Satz zwischendurch ersetzt, bleibt der alte gültig", async () => {
    const id = await enabledUser("replaced-midway");
    extra.push(id);
    const old = await issueActive(id, 3);
    const fresh = await issueRecoveryCodes(id, 3);
    let newest: string[] = [];
    // Zwischen der Suche nach dem Code und dem Umschalten legt ein
    // anderer Tab einen neuen Satz an.
    hooks.beforeTransaction = async () => {
      newest = await issueRecoveryCodes(id, 3);
    };

    expect(await confirmRecoveryCodes(id, fresh[0])).toBe("stale");

    // Das Loeschen der alten Codes ist mit zurueckgerollt: ohne diese
    // Pruefung stuende das Konto hier mit aktivem Faktor und null Codes.
    expect(await countActiveRecoveryCodes(id)).toBe(3);
    expect(await consumeRecoveryCode(id, old[1])).toBe(true);
    // Der neueste Satz wartet weiter auf seine eigene Bestaetigung.
    expect(await confirmRecoveryCodes(id, newest[0])).toBe("renewed");
  });

  it("gleichzeitige Bestätigungen enden in genau einem gültigen Satz", async () => {
    const id = await enabledUser("race");
    extra.push(id);
    const old = await issueActive(id, 3);
    const fresh = await issueRecoveryCodes(id, 3);

    const results = await Promise.all(
      fresh.map((code) => confirmRecoveryCodes(id, code)),
    );
    // Genau eine gewinnt. Wer den Satz vorher noch wartend sah, wartet
    // auf die Sperre der Nutzerzeile und findet ihn danach nicht mehr
    // (`stale`); wer erst danach nachschlaegt, findet seinen Code schon
    // aktiv (`already`). `wrong` waere hier falsch: jeder Code stammt
    // aus dem Satz.
    expect(results.filter((r) => r === "renewed")).toHaveLength(1);
    for (const r of results) expect(["renewed", "stale", "already"]).toContain(r);

    const rows = await snapshot(id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.pendingUntil === null)).toBe(true);
    expect(await consumeRecoveryCode(id, old[0])).toBe(false);
    expect(await consumeRecoveryCode(id, fresh[0])).toBe(true);
  });

  // Bei der Einrichtung schreibt die Bestaetigung auch die Nutzerzeile
  // (totpEnabledAt). Mit einer geteilten Sperre (FOR SHARE) hielten zwei
  // Bestaetigungen sie beide, und jede wartete beim Schreiben auf die
  // andere: 40P01. Der Test oben laeuft im Erneuern-Zweig, der die Zeile
  // nicht schreibt, und saehe das nicht. Mehrere Konten, damit der
  // Wettlauf sicher entsteht.
  it("gleichzeitige Bestätigungen bei der Einrichtung verklemmen sich nicht", async () => {
    const konten = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => setupUser(`setup-race-${n}`, true)),
    );
    const saetze = await Promise.all(
      konten.map((id) => issueRecoveryCodes(id, 4)),
    );

    const ergebnisse = await Promise.all(
      konten.map((id, i) =>
        Promise.allSettled(
          saetze[i].map((code) => confirmRecoveryCodes(id, code)),
        ),
      ),
    );

    for (const [i, id] of konten.entries()) {
      const werte = ergebnisse[i].map((r) =>
        r.status === "fulfilled" ? r.value : `abgelehnt: ${String(r.reason)}`,
      );
      expect(werte.filter((w) => w === "enabled"), id).toHaveLength(1);
      for (const w of werte) expect(["enabled", "stale", "already"]).toContain(w);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id },
        select: { totpEnabledAt: true },
      });
      expect(user.totpEnabledAt).not.toBeNull();
      expect(await countActiveRecoveryCodes(id)).toBe(4);
    }
  });

  it("ein falscher Bestätigungscode ändert nichts", async () => {
    const id = await enabledUser("wrong");
    extra.push(id);
    const old = await issueActive(id, 3);
    const fresh = await issueRecoveryCodes(id, 3);
    const before = await snapshot(id);

    expect(await confirmRecoveryCodes(id, "0000000000-0000000000")).toBe(
      "wrong",
    );
    // Auch ein alter, gueltiger Code ist keine Bestaetigung des neuen
    // Satzes — sonst bewiese sie nichts.
    expect(await confirmRecoveryCodes(id, old[1])).toBe("wrong");
    // Und ein fremder ausstehender Code erst recht nicht.
    const foreign = await issueRecoveryCodes(otherId, 2);
    expect(await confirmRecoveryCodes(id, foreign[0])).toBe("wrong");
    await discardPendingRecoveryCodes(otherId);

    expect(await snapshot(id)).toEqual(before);
    expect(await consumeRecoveryCode(id, old[1])).toBe(true);
    expect(await consumeRecoveryCode(id, fresh[0])).toBe(false);
  });

  it("nach Ablauf der Frist bestätigt nichts mehr", async () => {
    const id = await enabledUser("expired");
    extra.push(id);
    const old = await issueActive(id, 2);
    const fresh = await issueRecoveryCodes(id, 2);
    const before = await snapshot(id);

    // Nur die Uhr der Anwendung vorstellen; Datenbank und Verbindungen
    // laufen normal weiter.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + RECOVERY_CODE_CONFIRM_MS + 60_000);
      expect(await confirmRecoveryCodes(id, fresh[0])).toBe("expired");
    } finally {
      vi.useRealTimers();
    }

    expect(await snapshot(id)).toEqual(before);
    expect(await consumeRecoveryCode(id, fresh[0])).toBe(false);
    expect(await consumeRecoveryCode(id, old[1])).toBe(true);
  });

  it("gilt innerhalb der Frist", async () => {
    const id = await enabledUser("intime");
    extra.push(id);
    const fresh = await issueRecoveryCodes(id, 2);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + RECOVERY_CODE_CONFIRM_MS - 60_000);
      expect(await confirmRecoveryCodes(id, fresh[0])).toBe("renewed");
    } finally {
      vi.useRealTimers();
    }
    expect(await consumeRecoveryCode(id, fresh[1])).toBe(true);
  });

  it("ein neuer Satz ersetzt einen noch ausstehenden", async () => {
    const id = await enabledUser("replace");
    extra.push(id);
    const old = await issueActive(id, 2);
    const first = await issueRecoveryCodes(id, 2);
    const second = await issueRecoveryCodes(id, 2);

    expect(await confirmRecoveryCodes(id, first[0])).toBe("wrong");
    expect(await prisma.totpRecoveryCode.count({ where: { userId: id } })).toBe(
      4,
    );
    expect(await confirmRecoveryCodes(id, second[0])).toBe("renewed");
    expect(await consumeRecoveryCode(id, old[1])).toBe(false);
    expect(await consumeRecoveryCode(id, second[1])).toBe(true);
  });

  it("schaltet nur den Satz scharf, zu dem der Code gehört", async () => {
    const id = await enabledUser("own-set");
    extra.push(id);
    const fresh = await issueRecoveryCodes(id, 3);
    // Ein zweiter ausstehender Satz mit anderer Frist, wie ihn zwei
    // gleichzeitig abgeschickte Anfragen hinterlassen koennen. Die
    // Person hat nur einen davon vor sich — der andere darf mit dieser
    // Bestaetigung nicht mitgelten.
    const [row] = await prisma.totpRecoveryCode.findMany({
      where: { userId: id },
      select: { pendingUntil: true },
    });
    const other = generateRecoveryCodes(2);
    await prisma.totpRecoveryCode.createMany({
      data: other.map((code) => ({
        userId: id,
        codeHash: hashToken(normalizeRecoveryCode(code)),
        pendingUntil: new Date((row.pendingUntil?.getTime() ?? 0) + 1000),
      })),
    });

    expect(await confirmRecoveryCodes(id, fresh[0])).toBe("renewed");
    expect(await countActiveRecoveryCodes(id)).toBe(3);
    expect(await consumeRecoveryCode(id, other[0])).toBe(false);
  });

  it("verwerfen lässt die aktiven Codes stehen", async () => {
    const id = await enabledUser("discard");
    extra.push(id);
    const old = await issueActive(id, 2);
    const fresh = await issueRecoveryCodes(id, 2);
    await discardPendingRecoveryCodes(id);
    // Es wartet kein Satz mehr: nicht "falscher Code", sondern "nichts
    // mehr zu bestaetigen".
    expect(await confirmRecoveryCodes(id, fresh[0])).toBe("none");
    expect(await countActiveRecoveryCodes(id)).toBe(2);
    expect(await consumeRecoveryCode(id, old[1])).toBe(true);
  });

  it("eine wiederholte Bestätigung meldet: gilt schon", async () => {
    const id = await enabledUser("again");
    extra.push(id);
    const fresh = await issueRecoveryCodes(id, 3);
    expect(await confirmRecoveryCodes(id, fresh[0])).toBe("renewed");
    const before = await snapshot(id);

    // Die Antwort ging verloren, dieselbe Liste kommt noch einmal.
    expect(await confirmRecoveryCodes(id, fresh[0])).toBe("already");
    expect(await confirmRecoveryCodes(id, fresh[1])).toBe("already");
    expect(await snapshot(id)).toEqual(before);

    // Ein eingeloester Code gilt nicht mehr — "gilt schon" waere gelogen.
    expect(await consumeRecoveryCode(id, fresh[2])).toBe(true);
    expect(await confirmRecoveryCodes(id, fresh[2])).toBe("none");
  });

  it("wartet ein neuer Satz, ist ein aktiver Code kein 'gilt schon'", async () => {
    const id = await enabledUser("old-while-pending");
    extra.push(id);
    const old = await issueActive(id, 2);
    await issueRecoveryCodes(id, 2);
    // Meist ein alter Code vom Zettel statt einer aus der neuen Liste.
    // "Gilt schon" hiesse hier, die neue Liste sei bestaetigt.
    expect(await confirmRecoveryCodes(id, old[1])).toBe("wrong");
  });
});

describe("Einrichtung", () => {
  it("erst die Bestätigung der Codes schaltet den zweiten Faktor scharf", async () => {
    const id = await setupUser("setup", true);
    const codes = await issueRecoveryCodes(id, 3);

    // Codes ausgegeben, aber nichts bestaetigt: kein aktiver Faktor und
    // kein einloesbarer Code. Bricht die Person hier ab, bleibt das Konto
    // beim Passwort allein.
    const midway = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { totpEnabledAt: true },
    });
    expect(midway.totpEnabledAt).toBeNull();
    expect(await consumeRecoveryCode(id, codes[0])).toBe(false);

    expect(await confirmRecoveryCodes(id, codes[1])).toBe("enabled");
    const after = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { totpEnabledAt: true },
    });
    expect(after.totpEnabledAt).not.toBeNull();
    expect(await countActiveRecoveryCodes(id)).toBe(3);
  });

  it("ohne geprüften Code aus der App schaltet nichts scharf", async () => {
    // Abwehr in der Tiefe, kein Ablauf der Oberflaeche: ein neues
    // Geheimnis (Zeitschritt zurueckgesetzt) verwirft startTotpSetupAction
    // in derselben Transaktion mit allen ausstehenden Codes. Liegt
    // trotzdem ein Satz da, darf er das ungepruefte Geheimnis nicht
    // scharf schalten.
    const id = await setupUser("unverified", false);
    const codes = await issueRecoveryCodes(id, 2);
    const before = await snapshot(id);

    expect(await confirmRecoveryCodes(id, codes[0])).toBe("stale");

    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { totpEnabledAt: true },
    });
    expect(row.totpEnabledAt).toBeNull();
    expect(await snapshot(id)).toEqual(before);
  });

  it("ist das Geheimnis weg, schaltet ein liegengebliebener Satz nichts scharf", async () => {
    // cancelTotpSetupAction raeumt Geheimnis und ausstehende Codes in
    // EINER Transaktion weg; diesen Zwischenstand erzeugt es nicht. Wohl
    // aber disableTotpAction und das Zuruecksetzen durch die
    // Administration: sie loeschen erst das Geheimnis und danach, in
    // einem eigenen Schritt, die Codes. Eine Bestaetigung genau
    // dazwischen darf den Faktor nicht wieder scharf schalten.
    const id = await setupUser("cancelled", true);
    const codes = await issueRecoveryCodes(id, 2);
    await prisma.user.update({
      where: { id },
      data: { totpSecret: null, totpLastStep: null },
    });

    expect(await confirmRecoveryCodes(id, codes[0])).toBe("stale");
    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { totpEnabledAt: true },
    });
    expect(row.totpEnabledAt).toBeNull();
    expect(await consumeRecoveryCode(id, codes[1])).toBe(false);
  });
});
