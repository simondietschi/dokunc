import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@dokunc/db";

/**
 * Freigabelinks: der einzige Lesezugang ohne Konto.
 *
 * Alle Regeln stehen in Abfragebedingungen (resolveShare, die Datei-Route
 * der Freigabe und die Unterseitenliste der geteilten Seite). Geprueft
 * wird deshalb gegen echtes Postgres und ein eigenes Upload-Verzeichnis:
 * jede Absage muss dieselbe Antwort geben, damit ein anonymer Aufrufer
 * nicht erfaehrt, welcher Grund vorliegt.
 */

const uploadDir = mkdtempSync(path.join(tmpdir(), "dokunc-share-access-"));
const uploadDirVorher = process.env.UPLOAD_DIR;
process.env.UPLOAD_DIR = uploadDir;

const { GET } = await import("@/app/api/share/[id]/files/[name]/route");
const { default: SharedPage } = await import("@/app/share/[id]/page");
const { resolveShare } = await import("@/lib/share");
const { generateInviteToken } = await import("@/lib/invitations");
const { setPageRestricted } = await import("@/lib/page-access");
const { uploadDir: aktivesUploadDir } = await import("@/lib/uploads");
const { renderToStaticMarkup } = await import("react-dom/server");
if (aktivesUploadDir() !== path.resolve(uploadDir)) {
  throw new Error(`Upload-Verzeichnis ist nicht das Testverzeichnis: ${aktivesUploadDir()}`);
}

const TAG = `shacc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let userId: string;
let spaceId: string;
let otherSpaceId: string;

type SeitenName =
  | "eltern" | "wurzel" | "kind" | "enkel" | "geschwister"
  | "kindGeschuetzt" | "enkelGeschuetzt" | "kindKorb" | "enkelKorb"
  | "spaeterGeschuetzt" | "spaeterGeschuetztKind" | "imKorb" | "imKorbKind"
  | "fremd" | "fremdUnterWurzel" | "unterFremder";
const seite = {} as Record<SeitenName, string>;

type FreigabeName =
  | "nurSeite" | "mitKindern" | "andere" | "zurueckgezogen" | "abgelaufen"
  | "laeuftNoch" | "spaeterGeschuetzt" | "imKorb";
type Freigabe = { id: string; token: string };
const frei = {} as Record<FreigabeName, Freigabe>;

/** Gespeicherte Dateinamen je Fall (Form wie api/upload). */
const datei: Record<string, string> = {};

const titel = (name: SeitenName) => `${TAG}:${name}`;

async function neueSeite(name: SeitenName, parentId: string | null, inSpace = spaceId) {
  const page = await prisma.page.create({
    data: { spaceId: inSpace, parentId, title: titel(name) },
    select: { id: true },
  });
  seite[name] = page.id;
  return page.id;
}

/** Anhang samt Datei auf der Platte (ausser `ohneDatei`). */
async function neuerAnhang(
  fall: string,
  pageId: string | null,
  opts: { inSpace?: string; ohneDatei?: boolean } = {},
) {
  const storedName = `${randomBytes(16).toString("hex")}.png`;
  if (!opts.ohneDatei) writeFileSync(path.join(uploadDir, storedName), `inhalt-${fall}`);
  await prisma.attachment.create({
    data: {
      spaceId: opts.inSpace ?? spaceId,
      pageId,
      storedName,
      name: `${fall}.png`,
      mimeType: "image/png",
      size: 1,
    },
  });
  datei[fall] = storedName;
}

async function neueFreigabe(
  name: FreigabeName,
  pageId: string,
  data: { includeChildren?: boolean; expiresAt?: Date; revokedAt?: Date } = {},
) {
  const { token, tokenHash } = generateInviteToken();
  const share = await prisma.pageShare.create({
    data: { pageId, tokenHash, createdById: userId, ...data },
    select: { id: true },
  });
  frei[name] = { id: share.id, token };
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email: `${TAG}@example.test`, name: "Freigabe", passwordHash: "x" },
      select: { id: true },
    })
  ).id;
  const space = async (suffix: string) =>
    (
      await prisma.space.create({
        data: {
          name: `${TAG}-${suffix}`,
          slug: `${TAG}-${suffix}`,
          members: { create: [{ userId, role: "OWNER" }] },
        },
        select: { id: true },
      })
    ).id;
  spaceId = await space("space");
  otherSpaceId = await space("other");

  // eltern
  //   wurzel               <- die meisten Freigaben
  //     kind / enkel
  //     kindGeschuetzt / enkelGeschuetzt   (nach dem Teilen geschuetzt)
  //     kindKorb / enkelKorb               (nur das Kind im Papierkorb)
  //   geschwister
  // spaeterGeschuetzt / spaeterGeschuetztKind  (Wurzel nach dem Teilen geschuetzt)
  // imKorb / imKorbKind                        (nur die Wurzel nach dem Teilen im Papierkorb)
  const eltern = await neueSeite("eltern", null);
  const wurzel = await neueSeite("wurzel", eltern);
  const kind = await neueSeite("kind", wurzel);
  await neueSeite("enkel", kind);
  await neueSeite("geschwister", eltern);
  const kindGeschuetzt = await neueSeite("kindGeschuetzt", wurzel);
  await neueSeite("enkelGeschuetzt", kindGeschuetzt);
  const kindKorb = await neueSeite("kindKorb", wurzel);
  await neueSeite("enkelKorb", kindKorb);
  const spaeter = await neueSeite("spaeterGeschuetzt", null);
  await neueSeite("spaeterGeschuetztKind", spaeter);
  const imKorb = await neueSeite("imKorb", null);
  await neueSeite("imKorbKind", imKorb);
  await neueSeite("fremd", null, otherSpaceId);
  // Datenfehler: Seite eines anderen Space mit parentId in diesem.
  const fremdUnterWurzel = await neueSeite("fremdUnterWurzel", wurzel, otherSpaceId);
  // Darunter wieder eine Seite dieses Space: ihr Weg zur Freigabe fuehrt
  // ueber den anderen Space, der Unterbaum folgt ihm nicht (wie trashPageTree).
  await neueSeite("unterFremder", fremdUnterWurzel);

  await neueFreigabe("nurSeite", wurzel);
  await neueFreigabe("mitKindern", wurzel, { includeChildren: true });
  await neueFreigabe("andere", wurzel, { includeChildren: true });
  await neueFreigabe("zurueckgezogen", wurzel, { includeChildren: true, revokedAt: new Date() });
  await neueFreigabe("abgelaufen", wurzel, {
    includeChildren: true,
    expiresAt: new Date(Date.now() - 60_000),
  });
  await neueFreigabe("laeuftNoch", wurzel, {
    includeChildren: true,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await neueFreigabe("spaeterGeschuetzt", spaeter, { includeChildren: true });
  await neueFreigabe("imKorb", imKorb, { includeChildren: true });

  // Erst nach dem Teilen: geschuetzt bzw. geloescht.
  await setPageRestricted(kindGeschuetzt, true, userId);
  await setPageRestricted(spaeter, true, userId);
  await prisma.page.update({ where: { id: imKorb }, data: { deletedAt: new Date() } });
  // Nur das Kind, nicht sein Unterbaum: den Zustand hinterlassen
  // gleichzeitiges Anlegen und Loeschen oder aeltere Daten, und
  // detachLiveChildren rechnet ausdruecklich damit.
  await prisma.page.update({ where: { id: kindKorb }, data: { deletedAt: new Date() } });

  for (const name of Object.keys(seite) as SeitenName[]) {
    const inSpace = name === "fremd" || name === "fremdUnterWurzel" ? otherSpaceId : spaceId;
    await neuerAnhang(name, seite[name], { inSpace });
  }
  await neuerAnhang("ohneSeite", null);
  await neuerAnhang("ohneDatei", wurzel, { ohneDatei: true });
  // Datenfehler: Zeile eines anderen Space, die auf die freigegebene Seite zeigt.
  await neuerAnhang("fremdeZeile", wurzel, { inSpace: otherSpaceId });
});

afterAll(async () => {
  await prisma.space.deleteMany({ where: { id: { in: [spaceId, otherSpaceId] } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  rmSync(uploadDir, { recursive: true, force: true });
  if (uploadDirVorher === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = uploadDirVorher;
});

// ---------------------------------------------------------------------------
// resolveShare

async function oeffnet(
  f: Freigabe,
  pageId?: string | string[],
  token: string | string[] = f.token,
): Promise<string | null> {
  const r = await resolveShare(f.id, token, pageId);
  return r?.page.id ?? null;
}

describe("resolveShare", () => {
  it("oeffnet die freigegebene Seite (Positivkontrolle)", async () => {
    expect(await oeffnet(frei.nurSeite)).toBe(seite.wurzel);
    expect(await oeffnet(frei.nurSeite, seite.wurzel)).toBe(seite.wurzel);
    expect(await oeffnet(frei.laeuftNoch)).toBe(seite.wurzel);
  });

  it("lehnt falsches, leeres und fremdes Token ab", async () => {
    expect(await oeffnet(frei.mitKindern, undefined, "falsch")).toBeNull();
    expect(await oeffnet(frei.mitKindern, undefined, "")).toBeNull();
    expect(await oeffnet(frei.mitKindern, undefined, frei.andere.token)).toBeNull();
    expect(await resolveShare(`${TAG}-unbekannt`, frei.mitKindern.token)).toBeNull();
  });

  it("lehnt Token und Seite als Liste ab (doppelter Suchparameter)", async () => {
    const f = frei.mitKindern;
    expect(await oeffnet(f, undefined, [f.token, f.token])).toBeNull();
    expect(await oeffnet(f, [seite.kind, seite.enkel])).toBeNull();
  });

  it("lehnt zurueckgezogene und abgelaufene Freigaben ab", async () => {
    expect(await oeffnet(frei.zurueckgezogen)).toBeNull();
    expect(await oeffnet(frei.abgelaufen)).toBeNull();
  });

  it("endet, wenn die Seite nach dem Teilen geloescht oder geschuetzt wird", async () => {
    expect(await oeffnet(frei.imKorb)).toBeNull();
    // Die Unterseite lebt noch, die freigegebene Seite nicht mehr.
    expect(await oeffnet(frei.imKorb, seite.imKorbKind)).toBeNull();
    expect(await oeffnet(frei.spaeterGeschuetzt)).toBeNull();
    expect(await oeffnet(frei.spaeterGeschuetzt, seite.spaeterGeschuetztKind)).toBeNull();
  });

  it("gibt Unterseiten nur mit includeChildren", async () => {
    expect(await oeffnet(frei.nurSeite, seite.kind)).toBeNull();
    expect(await oeffnet(frei.nurSeite, seite.enkel)).toBeNull();
    expect(await oeffnet(frei.mitKindern, seite.kind)).toBe(seite.kind);
    expect(await oeffnet(frei.mitKindern, seite.enkel)).toBe(seite.enkel);
  });

  it("bleibt im echten Unterbaum", async () => {
    const f = frei.mitKindern;
    expect(await oeffnet(f, seite.geschwister)).toBeNull();
    expect(await oeffnet(f, seite.eltern)).toBeNull();
    expect(await oeffnet(f, seite.spaeterGeschuetzt)).toBeNull();
    expect(await oeffnet(f, seite.fremd)).toBeNull();
    expect(await oeffnet(f, seite.fremdUnterWurzel)).toBeNull();
    expect(await oeffnet(f, seite.unterFremder)).toBeNull();
  });

  it("lehnt eine Seite null ab", async () => {
    // Ein Anhang ohne Seite ist nie von einer Freigabe gedeckt, auch
    // nicht als "keine abweichende Seite" (null ?? share.pageId).
    const f = frei.mitKindern;
    expect(await resolveShare(f.id, f.token, null as unknown as string)).toBeNull();
    expect(await oeffnet(f, seite.kind)).toBe(seite.kind);
  });

  it("laesst geschuetzte und geloeschte Unterseiten aus", async () => {
    const f = frei.mitKindern;
    expect(await oeffnet(f, seite.kindGeschuetzt)).toBeNull();
    expect(await oeffnet(f, seite.enkelGeschuetzt)).toBeNull();
    expect(await oeffnet(f, seite.kindKorb)).toBeNull();
  });

  it("fuehrt nicht durch eine geloeschte Zwischenseite", async () => {
    expect(await oeffnet(frei.mitKindern, seite.enkelKorb)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Datei-Route /api/share/[id]/files/[name]

type Antwort = { status: number; body: string; headers: Record<string, string> };

async function hole(id: string, name: string, token?: string): Promise<Antwort> {
  const qs = token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
  const res = await GET(new Request(`http://localhost/api/share/${id}/files/${name}${qs}`), {
    params: Promise.resolve({ id, name }),
  });
  return {
    status: res.status,
    body: await res.text(),
    headers: Object.fromEntries(res.headers.entries()),
  };
}

const ueber = (f: Freigabe, fall: string, token = f.token) => hole(f.id, datei[fall], token);

describe("Datei-Route der Freigabe", () => {
  let absage: Antwort;
  beforeAll(async () => {
    absage = await hole(`${TAG}-unbekannt`, datei.wurzel, frei.mitKindern.token);
  });

  it("die Referenz-Absage ist ein 404 mit JSON", () => {
    expect(absage.status).toBe(404);
    expect(JSON.parse(absage.body)).toEqual({ error: "Nicht gefunden" });
  });

  it("liefert Anhaenge der Seite und ihres Unterbaums (Positivkontrolle)", async () => {
    const wurzel = await ueber(frei.nurSeite, "wurzel");
    expect(wurzel.status).toBe(200);
    expect(wurzel.body).toBe("inhalt-wurzel");
    expect(wurzel.headers["content-type"]).toBe("image/png");
    expect((await ueber(frei.mitKindern, "kind")).body).toBe("inhalt-kind");
    expect((await ueber(frei.mitKindern, "enkel")).body).toBe("inhalt-enkel");
    expect((await ueber(frei.laeuftNoch, "wurzel")).status).toBe(200);
  });

  // Jede Absage gleicht der Referenz in Status, Inhalt und Kopfzeilen.
  const absagen: [string, () => Promise<Antwort>][] = [
    ["falsches Token", () => ueber(frei.mitKindern, "wurzel", "falsch")],
    ["leeres Token", () => ueber(frei.mitKindern, "wurzel", "")],
    ["ohne Token", () => hole(frei.mitKindern.id, datei.wurzel)],
    ["Token einer anderen Freigabe", () => ueber(frei.mitKindern, "wurzel", frei.andere.token)],
    ["zurueckgezogen", () => ueber(frei.zurueckgezogen, "wurzel")],
    ["abgelaufen", () => ueber(frei.abgelaufen, "wurzel")],
    ["Seite im Papierkorb", () => ueber(frei.imKorb, "imKorb")],
    ["lebende Unterseite einer Seite im Papierkorb", () => ueber(frei.imKorb, "imKorbKind")],
    ["Seite nachtraeglich geschuetzt", () => ueber(frei.spaeterGeschuetzt, "spaeterGeschuetzt")],
    ["Unterseite ohne includeChildren", () => ueber(frei.nurSeite, "kind")],
    ["Geschwisterseite", () => ueber(frei.mitKindern, "geschwister")],
    ["Elternseite", () => ueber(frei.mitKindern, "eltern")],
    ["geschuetzte Unterseite", () => ueber(frei.mitKindern, "kindGeschuetzt")],
    ["Enkel unter geschuetzter Unterseite", () => ueber(frei.mitKindern, "enkelGeschuetzt")],
    ["Unterseite im Papierkorb", () => ueber(frei.mitKindern, "kindKorb")],
    ["Enkel unter geloeschter Zwischenseite", () => ueber(frei.mitKindern, "enkelKorb")],
    ["Anhang ohne Seite", () => ueber(frei.mitKindern, "ohneSeite")],
    ["Anhang eines anderen Space", () => ueber(frei.mitKindern, "fremd")],
    ["Zeile eines anderen Space auf die freigegebene Seite", () => ueber(frei.mitKindern, "fremdeZeile")],
    ["Seite eines anderen Space unter der Freigabe", () => ueber(frei.mitKindern, "fremdUnterWurzel")],
    ["Seite unter einer Zwischenseite eines anderen Space", () => ueber(frei.mitKindern, "unterFremder")],
    ["Datei fehlt auf der Platte", () => ueber(frei.mitKindern, "ohneDatei")],
    ["unbekannter Dateiname", () => hole(frei.mitKindern.id, `${"0".repeat(32)}.png`, frei.mitKindern.token)],
  ];
  it.each(absagen)("%s: dieselbe 404", async (_fall, abruf) => {
    expect(await abruf()).toEqual(absage);
  });

  it("weist unsichere Dateinamen vor jeder Pruefung der Freigabe ab", async () => {
    const gueltig = await hole(frei.mitKindern.id, "..", frei.mitKindern.token);
    const unbekannt = await hole(`${TAG}-unbekannt`, "..", "x");
    expect(gueltig.status).toBe(400);
    expect(unbekannt).toEqual(gueltig);
  });
});

// ---------------------------------------------------------------------------
// Geteilte Seite /share/[id]

async function zeige(
  f: Freigabe | { id: string; token: string },
  sp: { token?: string | string[]; page?: string | string[] } = { token: f.token },
): Promise<string> {
  const el = await SharedPage({ params: Promise.resolve({ id: f.id }), searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(el);
}

function nichtGefunden(e: unknown): boolean {
  return (e as { digest?: unknown })?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";
}

describe("Geteilte Seite", () => {
  it("zeigt die Seite und nur offene, lebende Unterseiten", async () => {
    const html = await zeige(frei.mitKindern);
    expect(html).toContain(`>${titel("wurzel")}</h1>`);
    expect(html).toContain(`>${titel("kind")}</a>`);
    expect(html).not.toContain(titel("kindGeschuetzt"));
    expect(html).not.toContain(titel("kindKorb"));
    expect(html).not.toContain(titel("fremdUnterWurzel"));
  });

  it("oeffnet Unterseiten ueber ?page= (Positivkontrolle)", async () => {
    const f = frei.mitKindern;
    expect(await zeige(f, { token: f.token, page: seite.kind })).toContain(`>${titel("kind")}</h1>`);
    expect(await zeige(f, { token: f.token, page: seite.enkel })).toContain(`>${titel("enkel")}</h1>`);
    // Die Links der Unterseitenliste tragen Seite und kodiertes Token.
    const html = await zeige(f);
    expect(html).toContain(
      `href="/share/${f.id}?token=${encodeURIComponent(f.token)}&amp;page=${seite.kind}"`,
    );
  });

  it("listet ohne includeChildren keine Unterseiten", async () => {
    const html = await zeige(frei.nurSeite);
    expect(html).toContain(`>${titel("wurzel")}</h1>`);
    expect(html).not.toContain(titel("kind"));
  });

  const f = () => frei.mitKindern;
  const absagen: [string, () => Promise<string>][] = [
    ["unbekannte Freigabe", () => zeige({ id: `${TAG}-unbekannt`, token: f().token })],
    ["falsches Token", () => zeige(f(), { token: "falsch" })],
    ["ohne Token", () => zeige(f(), {})],
    ["Token als Liste", () => zeige(f(), { token: [f().token, "b"] })],
    ["Seite als Liste", () => zeige(f(), { token: f().token, page: [seite.kind, seite.enkel] })],
    ["zurueckgezogen", () => zeige(frei.zurueckgezogen)],
    ["abgelaufen", () => zeige(frei.abgelaufen)],
    ["Seite im Papierkorb", () => zeige(frei.imKorb)],
    ["lebende Unterseite einer Seite im Papierkorb", () => zeige(frei.imKorb, { token: frei.imKorb.token, page: seite.imKorbKind })],
    ["Seite nachtraeglich geschuetzt", () => zeige(frei.spaeterGeschuetzt)],
    ["Unterseite ohne includeChildren", () => zeige(frei.nurSeite, { token: frei.nurSeite.token, page: seite.kind })],
    ["Geschwisterseite", () => zeige(f(), { token: f().token, page: seite.geschwister })],
    ["Enkel unter geloeschter Zwischenseite", () => zeige(f(), { token: f().token, page: seite.enkelKorb })],
    ["Seite unter einer Zwischenseite eines anderen Space", () => zeige(f(), { token: f().token, page: seite.unterFremder })],
  ];
  it.each(absagen)("%s: notFound", async (_fall, abruf) => {
    const fehler = await abruf().then(
      () => null,
      (e: unknown) => e,
    );
    expect(nichtGefunden(fehler), String(fehler)).toBe(true);
  });

  it("Token als Liste: dieselbe Absage wie bei einer zurueckgezogenen Freigabe", async () => {
    // Frueher: lebende Freigabe 500, andere 404. So liess sich ohne Token
    // pruefen, ob ein Link noch gilt.
    for (const fr of [frei.mitKindern, frei.zurueckgezogen]) {
      const fehler = await zeige(fr, { token: ["a", "b"] }).then(() => null, (e: unknown) => e);
      expect(nichtGefunden(fehler), String(fehler)).toBe(true);
    }
  });
});
