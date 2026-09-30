import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import { prisma } from "@dokunc/db";
import { deleteGroupAction } from "@/app/admin/groups/actions";
import {
  createPageAction,
  purgePageAction,
  restorePageAction,
} from "@/app/s/[slug]/actions";
import { movePageAction } from "@/app/s/[slug]/move-actions";
import {
  createFromTemplateAction,
  duplicatePageAction,
  saveAsTemplateAction,
} from "@/app/s/[slug]/template-actions";
import { BestaetigungNoetig, schutzwechselToken } from "@/lib/confirmation";
import { readablePageRole, refreshAccessRoots } from "@/lib/page-access";
import { trashPageTree } from "@/lib/page-guards";
import type { Akteur, InvariantenName } from "../rechtematrix/erwartung";
import { Umleitung, type Person, type Welt } from "./rechtematrix-welt";

/**
 * Treiber der Rechtematrix: je geprüftem Schlüssel und Szenario, wie ein
 * Fall vorbereitet, aufgerufen und seine Wirkung festgestellt wird.
 *
 * Jeder Fall legt frische Seiten an (nach dem Fall leert die Welt den
 * Space). `wirkung` fragt die Datenbank, nicht das Ergebnis des Aufrufs:
 * eine Action, die eine Fehlermeldung zurückgibt und trotzdem schreibt,
 * gilt als "erlaubt".
 */

/** Ausgang eines Aufrufs, bevor die Wirkung ihn einordnet. */
export type Ergebnis =
  | { art: "fertig"; wert?: unknown }
  | { art: "umleitung"; url: string }
  | { art: "fehler"; fehler: unknown }
  | { art: "bestaetigung"; token: string };

export type SzenarioTreiber<F> = {
  /** Frische Seiten für genau diesen Fall. */
  vorbereiten(w: Welt): Promise<F>;
  aufrufen(w: Welt, fx: F, a: Akteur): Promise<Ergebnis>;
  /** Hat die Aktion gewirkt? Vor dem Aufruf muss das false sein. */
  wirkung(w: Welt, fx: F): Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Bausteine

function person(w: Welt, a: Akteur): Person | null {
  return a === "abgemeldet" ? null : w.personen[a];
}

function formular(w: Welt, felder: Record<string, string>): FormData {
  const f = new FormData();
  f.set("slug", w.space.slug);
  for (const [k, v] of Object.entries(felder)) f.set(k, v);
  return f;
}

/** Rückfrage eines Zugs: `{ ok: false, confirm: token }`. */
function istRueckfrage(wert: unknown): wert is { confirm: string } {
  return (
    typeof wert === "object" &&
    wert !== null &&
    (wert as { ok?: unknown }).ok === false &&
    typeof (wert as { confirm?: unknown }).confirm === "string"
  );
}

/** Ruft `lauf` als Akteur auf und ordnet Rückgabe, Umleitung und Fehler ein. */
export async function rufe(
  w: Welt,
  a: Akteur,
  lauf: () => Promise<unknown>,
): Promise<Ergebnis> {
  try {
    const wert = await w.alsPerson(person(w, a), lauf);
    if (istRueckfrage(wert)) return { art: "bestaetigung", token: wert.confirm };
    return { art: "fertig", wert };
  } catch (e) {
    if (e instanceof Umleitung) return { art: "umleitung", url: e.url };
    if (e instanceof BestaetigungNoetig) return { art: "bestaetigung", token: e.token };
    return { art: "fehler", fehler: e };
  }
}

/**
 * Bestätigter Aufruf in zwei Stufen. Die Verwaltung ruft wie die
 * Oberfläche zuerst ohne Token und bestätigt dann mit dem gelieferten.
 * Alle anderen schicken gleich das richtig berechnete Token mit: auch
 * ein korrektes Token darf ihnen nichts freischalten.
 */
async function bestaetigt(
  w: Welt,
  a: Akteur,
  richtigesToken: () => Promise<string>,
  lauf: (token: string | undefined) => Promise<unknown>,
): Promise<Ergebnis> {
  const verwaltung = a === "ADMIN" || a === "OWNER";
  const token = verwaltung ? undefined : await richtigesToken();
  const erst = await rufe(w, a, () => lauf(token));
  if (erst.art !== "bestaetigung") return erst;
  return rufe(w, a, () => lauf(erst.token));
}

const neueMarke = () => `marke-${randomBytes(6).toString("hex")}`;

function inhalt(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

type Quelle = { id: string; marke: string };

/** Seite mit einer eindeutigen Marke im Text; Kopien tragen sie weiter. */
async function seite(
  w: Welt,
  o: { parentId?: string; isTemplate?: boolean } = {},
): Promise<Quelle> {
  const marke = neueMarke();
  const p = await prisma.page.create({
    data: {
      spaceId: w.space.id,
      parentId: o.parentId ?? null,
      title: marke,
      content: inhalt(marke),
      textContent: marke,
      isTemplate: o.isTemplate ?? false,
    },
    select: { id: true },
  });
  if (o.parentId) await refreshAccessRoots(p.id);
  return { id: p.id, marke };
}

async function inPapierkorb(w: Welt, pageId: string): Promise<void> {
  await trashPageTree(w.space.id, pageId);
}

async function zeile(pageId: string) {
  return prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      parentId: true,
      isRestricted: true,
      accessRootId: true,
      deletedAt: true,
      isTemplate: true,
    },
  });
}

/** Darf dieser Akteur die Seite öffnen (Rolle im Space und Schutz)? */
async function sieht(w: Welt, a: Akteur, pageId: string): Promise<boolean> {
  const p = person(w, a);
  if (!p) return false;
  return (await readablePageRole(p.id, pageId, w.space.id)) !== null;
}

/** Freigaben einer Seite als sortierte Menge `u:<id>` / `g:<id>`. */
async function grantMenge(pageId: string): Promise<string[]> {
  const grants = await prisma.pageGrant.findMany({
    where: { pageId },
    select: { userId: true, groupId: true },
  });
  return grants
    .map((g) => (g.userId ? `u:${g.userId}` : `g:${g.groupId}`))
    .sort();
}

/** Gibt es einen Audit-Eintrag mit diesen Metadaten? */
async function auditMit(
  action: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<boolean> {
  const eintraege = await prisma.auditLog.findMany({
    where: { action, targetId },
    select: { metadata: true },
  });
  return eintraege.some((e) => {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    return Object.entries(metadata).every(([k, v]) => m[k] === v);
  });
}

/** Seiten im Space ausser der Quelle, die deren Marke tragen. */
async function kopienVon(w: Welt, q: Quelle) {
  return prisma.page.findMany({
    where: {
      spaceId: w.space.id,
      deletedAt: null,
      id: { not: q.id },
      textContent: { contains: q.marke },
    },
    select: { id: true, isRestricted: true, accessRootId: true },
  });
}

const RAUM_AKTEURE = [
  "VIEWER",
  "MEMBER",
  "MEMBER_FREIGABE",
  "ADMIN",
  "OWNER",
] as const satisfies readonly Akteur[];

/**
 * Jede Kopie einer Quelle ist für jede Rolle genau so sichtbar wie die
 * Quelle. Eine Kopie einer Schutzwurzel ist selbst Schutzwurzel mit den
 * Freigaben der Quelle, und die Übernahme steht im Audit. Eine Kopie
 * einer offenen Seite trägt keinen eigenen Schutz; im Modus "offen"
 * steht sie zudem unter derselben wirksamen Wurzel wie die Quelle.
 */
async function pruefeKopien(
  w: Welt,
  quellen: readonly Quelle[],
  modus: "geschuetzt" | "offen",
): Promise<void> {
  for (const q of quellen) {
    const quelle = await zeile(q.id);
    if (!quelle) throw new Error(`Quelle ${q.id} fehlt`);
    for (const k of await kopienVon(w, q)) {
      const wo = `Kopie ${k.id} von ${q.id}`;
      for (const a of RAUM_AKTEURE) {
        expect(await sieht(w, a, k.id), `${wo}: Sicht für ${a}`).toBe(
          await sieht(w, a, q.id),
        );
      }
      if (modus === "offen" || !quelle.isRestricted) {
        expect(k.isRestricted, `${wo}: eigener Schutz`).toBe(false);
        expect(await grantMenge(k.id), `${wo}: eigene Freigaben`).toEqual([]);
        if (modus === "offen") {
          expect(k.accessRootId, `${wo}: wirksame Wurzel`).toBe(
            quelle.accessRootId,
          );
          expect(
            await auditMit("page.protection_carried", k.id),
            `${wo}: Audit einer Übernahme`,
          ).toBe(false);
        }
      } else {
        expect(k.isRestricted, `${wo}: eigener Schutz`).toBe(true);
        expect(k.accessRootId, `${wo}: wirksame Wurzel`).toBe(k.id);
        expect(await grantMenge(k.id), `${wo}: Freigaben`).toEqual(
          await grantMenge(q.id),
        );
        expect(
          await auditMit("page.protection_carried", k.id),
          `${wo}: Audit page.protection_carried`,
        ).toBe(true);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Invarianten: nach "erlaubt", hält der Schutz?

type KopieFx = { quellen: Quelle[] };
type WiederFx = { kind: string; wurzel: string };
type VorlageFx = { quelle: Quelle };
/** Zug von `seite` unter `ziel` (null = oberste Ebene); `wurzel` = Schutzwurzel im Spiel. */
type ZugFx = { seite: string; ziel: string | null; wurzel: string | null };

/**
 * Prüfung nach "erlaubt". Als Methode deklariert, damit jede Invariante
 * ihre eigene Form der Vorbereitung annehmen darf (bivariante Parameter).
 */
type Invariante = {
  pruefe(w: Welt, fx: unknown): Promise<void>;
}["pruefe"];

export const INVARIANTEN: Record<InvariantenName, Invariante> = {
  async kopieGeschuetzt(w, fx: KopieFx) {
    await pruefeKopien(w, fx.quellen, "geschuetzt");
  },
  async kopieOffen(w, fx: KopieFx) {
    expect(
      (await kopienVon(w, fx.quellen[0])).length,
      "keine Kopie entstanden",
    ).toBeGreaterThan(0);
    await pruefeKopien(w, fx.quellen, "offen");
  },
  async vorlageFreigegeben(w, fx: VorlageFx) {
    const vorlagen = (await kopienVon(w, fx.quelle)).filter(
      (k) => k.accessRootId === null && !k.isRestricted,
    );
    const alle = await kopienVon(w, fx.quelle);
    expect(alle.length, "genau eine Vorlage").toBe(1);
    expect(vorlagen.length, "die Vorlage ist offen").toBe(1);
    const t = alle[0];
    expect((await zeile(t.id))?.isTemplate).toBe(true);
    expect(await grantMenge(t.id)).toEqual([]);
    expect(
      await auditMit("page.protection_changed", t.id, {
        via: "template",
        confirmed: true,
      }),
      "Audit page.protection_changed mit confirmed: true",
    ).toBe(true);
  },
  async wiederhergestellt(w, fx: WiederFx) {
    const k = await zeile(fx.kind);
    expect(k?.deletedAt).toBeNull();
    expect(k?.parentId, "hängt oben").toBeNull();
    expect(k?.isRestricted, "eigener Schutz").toBe(true);
    expect(k?.accessRootId, "eigene Wurzel").toBe(fx.kind);
    expect(await grantMenge(fx.kind), "Freigaben der alten Wurzel").toEqual(
      await grantMenge(fx.wurzel),
    );
    expect(await sieht(w, "MEMBER", fx.kind), "MEMBER ohne Freigabe").toBe(false);
    expect(await sieht(w, "MEMBER_FREIGABE", fx.kind)).toBe(true);
    expect(
      await auditMit("page.protection_carried", fx.kind, { via: "restore" }),
      "Audit page.protection_carried",
    ).toBe(true);
  },
  async zugBestaetigt(_w, fx: ZugFx) {
    const s = await zeile(fx.seite);
    expect(s?.parentId).toBe(fx.ziel);
    expect(s?.accessRootId, "offen").toBeNull();
    expect(
      await auditMit("page.protection_changed", fx.seite, {
        via: "move",
        confirmed: true,
      }),
      "Audit page.protection_changed mit confirmed: true",
    ).toBe(true);
  },
  async zugInSchutz(w, fx: ZugFx) {
    const s = await zeile(fx.seite);
    expect(s?.parentId).toBe(fx.ziel);
    expect(s?.accessRootId, "unter der Wurzel des Ziels").toBe(fx.wurzel);
    expect(await sieht(w, "MEMBER", fx.seite), "MEMBER ohne Freigabe").toBe(false);
    expect(
      await auditMit("page.protection_changed", fx.seite, {
        via: "move",
        confirmed: false,
      }),
      "Audit page.protection_changed mit confirmed: false",
    ).toBe(true);
  },
  async titelAktuell() {
    throw new Error("Invariante titelAktuell ist noch nicht umgesetzt");
  },
};

// ---------------------------------------------------------------------------
// Treiber je Schlüssel

/** Kopie-Szenarien: Wirkung = eine Seite mit der Marke der ersten Quelle. */
function kopieTreiber(
  vorbereiten: (w: Welt) => Promise<KopieFx & { ziel: string }>,
  aufrufen: (w: Welt, fx: KopieFx & { ziel: string }) => Promise<unknown>,
  o: { nurVorlagen?: boolean } = {},
): SzenarioTreiber<KopieFx & { ziel: string }> {
  return {
    vorbereiten,
    aufrufen: (w, fx, a) => rufe(w, a, () => aufrufen(w, fx)),
    async wirkung(w, fx) {
      const kopien = await prisma.page.count({
        where: {
          spaceId: w.space.id,
          deletedAt: null,
          id: { not: fx.quellen[0].id },
          textContent: { contains: fx.quellen[0].marke },
          ...(o.nurVorlagen === undefined ? {} : { isTemplate: o.nurVorlagen }),
        },
      });
      return kopien > 0;
    },
  };
}

function zugTreiber(
  aufbau: (w: Welt) => Promise<ZugFx>,
  o: { bestaetigt?: boolean } = {},
): SzenarioTreiber<ZugFx> {
  const lauf = (w: Welt, fx: ZugFx, token?: string) =>
    movePageAction(
      formular(w, {
        pageId: fx.seite,
        parentId: fx.ziel ?? "",
        ...(token ? { confirmProtection: token } : {}),
      }),
    );
  return {
    vorbereiten: aufbau,
    aufrufen(w, fx, a) {
      if (!o.bestaetigt) return rufe(w, a, () => lauf(w, fx));
      return bestaetigt(
        w,
        a,
        async () => {
          const s = await zeile(fx.seite);
          const ziel = fx.ziel ? await zeile(fx.ziel) : null;
          return schutzwechselToken(
            s?.accessRootId ?? null,
            s?.isRestricted ? fx.seite : (ziel?.accessRootId ?? null),
          );
        },
        (token) => lauf(w, fx, token),
      );
    },
    async wirkung(_w, fx) {
      return (await zeile(fx.seite))?.parentId === fx.ziel;
    },
  };
}

/** Geschützter Ast R mit offener Unterseite C. */
async function geschuetzterAst(w: Welt): Promise<{ r: string; c: string }> {
  const r = await seite(w);
  const c = await seite(w, { parentId: r.id });
  await w.schuetze(r.id);
  return { r: r.id, c: c.id };
}

export const TREIBER: Record<string, Record<string, SzenarioTreiber<unknown>>> = {
  "action:app/admin/groups/actions.ts#deleteGroupAction": {
    "Gruppe mit Space-Rolle und Seitenfreigabe": {
      async vorbereiten(w) {
        const gruppe = await prisma.group.create({
          data: {
            name: `${w.space.slug}-${neueMarke()}`,
            members: { create: [{ userId: w.personen.MEMBER.id }] },
            spaces: { create: [{ spaceId: w.space.id, role: "MEMBER" }] },
          },
          select: { id: true },
        });
        w.spaeter(() => prisma.group.deleteMany({ where: { id: gruppe.id } }));
        const q = await seite(w);
        await w.schuetze(q.id);
        await prisma.pageGrant.create({
          data: { pageId: q.id, groupId: gruppe.id },
        });
        return { gruppe: gruppe.id };
      },
      aufrufen: (w, fx: { gruppe: string }, a) =>
        rufe(w, a, () => deleteGroupAction(formular(w, { groupId: fx.gruppe }))),
      async wirkung(_w, fx: { gruppe: string }) {
        return (await prisma.group.count({ where: { id: fx.gruppe } })) === 0;
      },
    },
  },

  "action:app/s/[slug]/actions.ts#createPageAction": {
    "unter offener Seite": {
      async vorbereiten(w) {
        return { eltern: (await seite(w)).id };
      },
      aufrufen: (w, fx: { eltern: string }, a) =>
        rufe(w, a, () => createPageAction(formular(w, { parentId: fx.eltern }))),
      async wirkung(_w, fx: { eltern: string }) {
        return (await prisma.page.count({ where: { parentId: fx.eltern } })) > 0;
      },
    },
    "mit templateId einer geschützten Vorlage": {
      async vorbereiten(w): Promise<KopieFx & { vorlage: string }> {
        const t = await seite(w, { isTemplate: true });
        await w.schuetze(t.id);
        return { quellen: [t], vorlage: t.id };
      },
      aufrufen: (w, fx: { vorlage: string }, a) =>
        rufe(w, a, () =>
          createPageAction(formular(w, { templateId: fx.vorlage })),
        ),
      // Irgendeine neue Seite: ob sie den Inhalt der Vorlage trägt, prüft
      // die Invariante.
      async wirkung(w) {
        return (
          (await prisma.page.count({
            where: { spaceId: w.space.id, isTemplate: false },
          })) > 0
        );
      },
    },
  },

  "action:app/s/[slug]/actions.ts#purgePageAction": {
    "offene Seite im Papierkorb": {
      async vorbereiten(w) {
        const p = await seite(w);
        await inPapierkorb(w, p.id);
        return { seite: p.id };
      },
      aufrufen: (w, fx: { seite: string }, a) =>
        rufe(w, a, () => purgePageAction(formular(w, { pageId: fx.seite }))),
      async wirkung(_w, fx: { seite: string }) {
        return (await zeile(fx.seite)) === null;
      },
    },
    "geschützte Seite im Papierkorb": {
      async vorbereiten(w) {
        const p = await seite(w);
        await w.schuetze(p.id);
        await inPapierkorb(w, p.id);
        return { seite: p.id };
      },
      aufrufen: (w, fx: { seite: string }, a) =>
        rufe(w, a, () => purgePageAction(formular(w, { pageId: fx.seite }))),
      async wirkung(_w, fx: { seite: string }) {
        return (await zeile(fx.seite)) === null;
      },
    },
  },

  "action:app/s/[slug]/actions.ts#restorePageAction": {
    "offene Seite im Papierkorb": {
      async vorbereiten(w) {
        const p = await seite(w);
        await inPapierkorb(w, p.id);
        return { seite: p.id };
      },
      aufrufen: (w, fx: { seite: string }, a) =>
        rufe(w, a, () => restorePageAction(formular(w, { pageId: fx.seite }))),
      async wirkung(_w, fx: { seite: string }) {
        return (await zeile(fx.seite))?.deletedAt === null;
      },
    },
    "Unterseite, geschützte Elternseite bleibt im Papierkorb": {
      async vorbereiten(w): Promise<WiederFx> {
        const { r, c } = await geschuetzterAst(w);
        await inPapierkorb(w, r);
        return { kind: c, wurzel: r };
      },
      aufrufen: (w, fx: WiederFx, a) =>
        rufe(w, a, () => restorePageAction(formular(w, { pageId: fx.kind }))),
      async wirkung(_w, fx: WiederFx) {
        return (await zeile(fx.kind))?.deletedAt === null;
      },
    },
  },

  "action:app/s/[slug]/move-actions.ts#movePageAction": {
    "offene Seite unter offene Seite": zugTreiber(async (w) => {
      const a = await seite(w);
      const b = await seite(w);
      return { seite: a.id, ziel: b.id, wurzel: null };
    }),
    "aus geschütztem Ast an die oberste Ebene": zugTreiber(async (w) => {
      const { r, c } = await geschuetzterAst(w);
      return { seite: c, ziel: null, wurzel: r };
    }),
    "aus geschütztem Ast an die oberste Ebene, bestätigt": zugTreiber(
      async (w) => {
        const { r, c } = await geschuetzterAst(w);
        return { seite: c, ziel: null, wurzel: r };
      },
      { bestaetigt: true },
    ),
    "von einer Schutzwurzel unter eine andere": zugTreiber(async (w) => {
      const { r, c } = await geschuetzterAst(w);
      const r2 = await seite(w);
      await w.schuetze(r2.id);
      return { seite: c, ziel: r2.id, wurzel: r };
    }),
    "offene Seite in geschützten Ast": zugTreiber(async (w) => {
      const x = await seite(w);
      const r = await seite(w);
      await w.schuetze(r.id);
      return { seite: x.id, ziel: r.id, wurzel: r.id };
    }),
    "geschützte Wurzel an die oberste Ebene": zugTreiber(async (w) => {
      const p = await seite(w);
      const r = await seite(w, { parentId: p.id });
      await w.schuetze(r.id);
      return { seite: r.id, ziel: null, wurzel: r.id };
    }),
  },

  "action:app/s/[slug]/template-actions.ts#createFromTemplateAction": {
    "offene Vorlage": kopieTreiber(
      async (w) => {
        const t = await seite(w, { isTemplate: true });
        return { quellen: [t], ziel: t.id };
      },
      (w, fx) => createFromTemplateAction(formular(w, { templateId: fx.ziel })),
      { nurVorlagen: false },
    ),
    "geschützte Vorlage": kopieTreiber(
      async (w) => {
        const t = await seite(w, { isTemplate: true });
        await w.schuetze(t.id);
        return { quellen: [t], ziel: t.id };
      },
      (w, fx) => createFromTemplateAction(formular(w, { templateId: fx.ziel })),
      { nurVorlagen: false },
    ),
  },

  "action:app/s/[slug]/template-actions.ts#duplicatePageAction": {
    "offene Seite": kopieTreiber(
      async (w) => {
        const p = await seite(w);
        return { quellen: [p], ziel: p.id };
      },
      (w, fx) => duplicatePageAction(formular(w, { pageId: fx.ziel })),
    ),
    "offene Seite unter geschützter Elternseite": kopieTreiber(
      async (w) => {
        const r = await seite(w);
        const c = await seite(w, { parentId: r.id });
        await w.schuetze(r.id);
        return { quellen: [c], ziel: c.id };
      },
      (w, fx) => duplicatePageAction(formular(w, { pageId: fx.ziel })),
    ),
    "geschützte Seite auf oberster Ebene": kopieTreiber(
      async (w) => {
        const p = await seite(w);
        await w.schuetze(p.id);
        return { quellen: [p], ziel: p.id };
      },
      (w, fx) => duplicatePageAction(formular(w, { pageId: fx.ziel })),
    ),
    "offene Seite mit geschützter Unterseite": kopieTreiber(
      async (w) => {
        const p = await seite(w);
        const n = await seite(w, { parentId: p.id });
        await w.schuetze(n.id);
        return { quellen: [p, n], ziel: p.id };
      },
      (w, fx) =>
        duplicatePageAction(
          formular(w, { pageId: fx.ziel, withChildren: "1" }),
        ),
    ),
  },

  "action:app/s/[slug]/template-actions.ts#saveAsTemplateAction": {
    "offene Seite": kopieTreiber(
      async (w) => {
        const p = await seite(w);
        return { quellen: [p], ziel: p.id };
      },
      (w, fx) => saveAsTemplateAction(formular(w, { pageId: fx.ziel })),
      { nurVorlagen: true },
    ),
    "geschützte Seite": kopieTreiber(
      async (w) => {
        const p = await seite(w);
        await w.schuetze(p.id);
        return { quellen: [p], ziel: p.id };
      },
      (w, fx) => saveAsTemplateAction(formular(w, { pageId: fx.ziel })),
      { nurVorlagen: true },
    ),
    "geschützte Seite, bestätigt": {
      async vorbereiten(w): Promise<VorlageFx> {
        const p = await seite(w);
        await w.schuetze(p.id);
        return { quelle: p };
      },
      aufrufen: (w, fx: VorlageFx, a) =>
        bestaetigt(
          w,
          a,
          async () =>
            schutzwechselToken(
              (await zeile(fx.quelle.id))?.accessRootId ?? null,
              null,
            ),
          (token) =>
            saveAsTemplateAction(
              formular(w, {
                pageId: fx.quelle.id,
                ...(token ? { confirmProtection: token } : {}),
              }),
            ),
        ),
      async wirkung(w, fx: VorlageFx) {
        return (
          (await prisma.page.count({
            where: {
              spaceId: w.space.id,
              isTemplate: true,
              textContent: { contains: fx.quelle.marke },
            },
          })) > 0
        );
      },
    },
  },
};
