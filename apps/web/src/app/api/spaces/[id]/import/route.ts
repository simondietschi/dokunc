import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { getCurrentUser } from "@/lib/current-user";
import { isSameOrigin, originRejectionHint } from "@/lib/origin";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { can } from "@/lib/permissions";
import { effectiveRole } from "@/lib/space-access";
import { log } from "@/lib/log";
import { declaredBodySize } from "@/lib/body-size";
import { visiblePageWhere } from "@/lib/page-access";
import { extractZip, newZipBudget, ZIP_MAX_FILE } from "@/lib/import/zip";
import { runImport } from "@/lib/import/run";
import { ImportRolledBack } from "@/lib/import/rollback";
import { acquireAccountImportSlot, acquireImportSlot } from "@/lib/import/slots";
import { UPLOAD_READ_LIMITS, guardUpload } from "@/lib/import/upload-read";
import { ImportError, fileFromBytes, type ImportFile } from "@/lib/import/types";
import { extname, isPageExt, normalizePath } from "@/lib/import/paths";
import {
  ACCEPTED_EXT,
  importMaxBytes,
  importMaxMb,
  importTimeoutMs,
} from "@/lib/import/limits";
import { RATE_LIMITS } from "@/lib/rate-limits";

export const runtime = "nodejs";
// Greift nur auf Plattformen wie Vercel; `next start` setzt den Wert nie
// durch. Die Grenze, die beim Selbsthosten wirkt, ist importTimeoutMs().
export const maxDuration = 120;

const accepted = new Set<string>(ACCEPTED_EXT);

/** Eine hochgeladene Datei, schon gelesen. */
type Upload = { name: string; bytes: Uint8Array };

/**
 * Formular lesen und NUR die Bytes behalten. Die File-Objekte aus
 * formData() halten ihre eigene Kopie des Uploads; lebten sie bis zum
 * Ende des Imports weiter (als Variable in POST), laege jeder Upload
 * zweimal im Speicher, solange die Seiten angelegt werden. Hier sind sie
 * nach der Rueckkehr nicht mehr erreichbar.
 *
 * Gelesen wird mit Frist (lib/import/upload-read): die Import-Plaetze
 * sind hier schon belegt, und ein absichtlich langsamer Upload soll sie
 * nicht bis zum requestTimeout von Node halten.
 */
async function readUploads(
  req: Request,
  userId: string,
  maxBytes: number,
): Promise<{ uploads: Upload[]; parentId: string } | NextResponse> {
  const guarded = req.body
    ? guardUpload(req.body, {
        ...UPLOAD_READ_LIMITS,
        // Dieselbe Obergrenze wie die Vorpruefung am Header.
        maxBytes: maxBytes + 64 * 1024,
      })
    : null;
  let form: FormData;
  try {
    form = await new Response(guarded?.body ?? null, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    const stop = guarded?.stopped();
    if (stop === "zu-langsam") {
      log.warn({ userId }, "Import: Upload zu langsam, abgebrochen");
      return NextResponse.json(
        {
          error:
            "Der Upload kam zu langsam an und wurde abgebrochen. Bitte erneut versuchen, bei langsamer Verbindung in kleineren Teilen.",
        },
        { status: 408 },
      );
    }
    if (stop === "zu-gross") {
      return NextResponse.json(
        { error: `Upload zu gross (max. ${importMaxMb()} MB).` },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Keine Datei ausgewählt" }, { status: 400 });
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > maxBytes) {
    return NextResponse.json(
      { error: `Upload zu gross (max. ${importMaxMb()} MB).` },
      { status: 413 },
    );
  }
  const uploads: Upload[] = [];
  for (const f of files) {
    // Nicht angenommene Formate gar nicht erst in den Speicher holen.
    const bytes = accepted.has(extname(f.name))
      ? new Uint8Array(await f.arrayBuffer())
      : new Uint8Array(0);
    uploads.push({ name: f.name, bytes });
  }
  return { uploads, parentId: String(form.get("parentId") ?? "").trim() };
}

const NICHTS_ANGELEGT = "Es wurden keine Seiten angelegt.";

/**
 * POST /api/spaces/[id]/import — multipart mit `files` (mehrere) und
 * optional `parentId`. Importiert Markdown-/HTML-Dateien oder Zips
 * (Markdown-Baum, Confluence-HTML-Export, Notion-Export) als Seiten.
 * Antwort: { pages, attachments, warnings[], roots: [{id,title}] }; bei
 * einem Fehler im Import selbst (ImportError, 400) { error, warnings[] }
 * mit den bis dahin gesammelten Hinweisen, bei allen anderen
 * Fehlerantworten nur { error }.
 *
 * Ein Import laeuft ganz oder gar nicht: bricht er ab (Fehler, Abbruch
 * der Anfrage, Zeitgrenze), wird das schon Angelegte zurueckgenommen
 * und die Fehlermeldung sagt, dass nichts angelegt blieb. 429 auch dann,
 * wenn dasselbe Konto schon einen Import laufen hat oder instanzweit
 * schon IMPORT_MAX_CONCURRENT Importe laufen; 408, wenn der Upload zu
 * langsam ankommt.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (
    !isSameOrigin(
      req.headers.get("origin"),
      process.env.APP_URL,
      req.headers.get("host"),
    )
  ) {
    // Der eine Fall, der sonst raetselhaft bleibt, gehoert ins Log:
    // die Instanz ist unter diesem Namen erreichbar, APP_URL nennt
    // aber einen anderen.
    const hinweis = originRejectionHint(
      req.headers.get("origin"),
      process.env.APP_URL,
      req.headers.get("host"),
    );
    if (hinweis) log.warn({ hinweis }, "Anfrage wegen fremder Herkunft abgelehnt");
    return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  const { id: spaceId } = await params;
  // Wirksame Rolle: eigene Mitgliedschaft ODER Gruppe. Wer ueber eine
  // Gruppe verwaltet, darf auch importieren.
  const [role, space] = await Promise.all([
    effectiveRole(user.id, spaceId),
    prisma.space.findUnique({
      where: { id: spaceId },
      select: { slug: true },
    }),
  ]);
  if (!space || !can(role, "managePages")) {
    return NextResponse.json({ error: "Kein Zugriff" }, { status: 403 });
  }

  // Beide Plaetze VOR der Bremse (je Konto und Client-Adresse, siehe
  // importWithSlot): wer nur wegen belegter Plaetze abgewiesen wird, soll
  // dafuer keinen seiner Versuche verlieren.
  // Erst der Platz des Kontos, dann der globale: ein zweiter Import
  // desselben Kontos wird abgewiesen, ohne einen globalen Platz auch nur
  // kurz zu belegen. So kann ein einzelnes Konto nie mehr als einen der
  // globalen Plaetze halten.
  const own = await acquireAccountImportSlot(user.id);
  if (!own) {
    return NextResponse.json(
      {
        error:
          "Es läuft bereits ein Import von dir. Bitte warte, bis er fertig ist, und versuche es dann erneut.",
      },
      { status: 429, headers: { "Retry-After": "30" } },
    );
  }
  try {
    const slot = await acquireImportSlot();
    if (!slot) {
      return NextResponse.json(
        {
          error:
            "Gerade laufen zu viele Importe gleichzeitig. Bitte in ein paar Minuten erneut versuchen.",
        },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    try {
      return await importWithSlot(req, user.id, spaceId, space.slug, role);
    } finally {
      await slot.release();
    }
  } finally {
    await own.release();
  }
}

async function importWithSlot(
  req: Request,
  userId: string,
  spaceId: string,
  slug: string,
  role: Awaited<ReturnType<typeof effectiveRole>>,
): Promise<NextResponse> {
  // Gezaehlt je Konto UND Client-Adresse (clientKey haengt die Adresse
  // an): dasselbe Konto hat von einer zweiten Adresse aus eigene
  // Versuche. Was ein Konto hoechstens gleichzeitig belegt, begrenzt der
  // Kontoplatz in POST, nicht diese Bremse.
  if (!(await rateLimit(
      await clientKey(`import:${userId}`),
      RATE_LIMITS.import.versuche,
      RATE_LIMITS.import.fenster,
    ))) {
    return NextResponse.json(
      { error: "Zu viele Importe. Bitte in ein paar Minuten erneut versuchen." },
      { status: 429 },
    );
  }

  // Dieselbe Vorpruefung wie in /api/upload und aus demselben Grund:
  // req.formData() weiter unten puffert den ganzen Koerper.
  const maxBytes = importMaxBytes();
  const declared = declaredBodySize(
    req.headers.get("content-length"),
    maxBytes + 64 * 1024,
  );
  if (declared.kind === "zu-gross") {
    return NextResponse.json(
      { error: `Upload zu gross (max. ${importMaxMb()} MB).` },
      { status: 413 },
    );
  }
  if (declared.kind === "unbekannt") {
    return NextResponse.json(
      { error: "Länge der Anfrage fehlt (Content-Length erforderlich)" },
      { status: 411 },
    );
  }

  const read = await readUploads(req, userId, maxBytes);
  if (read instanceof NextResponse) return read;
  const { uploads, parentId: requestedParent } = read;

  // Zielelternseite: muss zu DIESEM Space gehoeren UND fuer die
  // handelnde Person sichtbar sein (die ID kommt vom Client). Ohne den
  // zweiten Teil haengt jemand mit managePages Seiten unter eine
  // geschuetzte Seite, die er selbst nicht oeffnen darf.
  let parentId: string | null = null;
  if (requestedParent) {
    const parent = await prisma.page.findFirst({
      where: {
        id: requestedParent,
        spaceId,
        ...visiblePageWhere(userId, role),
        deletedAt: null,
        isTemplate: false,
      },
      select: { id: true },
    });
    if (!parent) {
      return NextResponse.json(
        { error: "Zielseite nicht gefunden" },
        { status: 400 },
      );
    }
    parentId = parent.id;
  }

  // Ab hier laeuft die Zeit. Der Upload selbst zaehlt nicht mit: wie
  // lange er dauert, haengt an der Leitung der Person, nicht an der
  // Arbeit, die er macht. `signal` bricht auch ab, wenn die Person die
  // Anfrage abbricht (Next reicht das Schliessen der Verbindung als
  // req.signal durch).
  const timer = AbortSignal.timeout(
    importTimeoutMs((ersetzt) =>
      log.warn(ersetzt, "IMPORT_TIMEOUT_S ungültig oder ausserhalb von 1 bis 3600 s, ersetzt"),
    ),
  );
  const signal = AbortSignal.any([req.signal, timer]);

  const files: ImportFile[] = [];
  const warnings: string[] = [];
  // Ein Budget fuer den GESAMTEN Request: mehrere Zips teilen sich die
  // Obergrenzen, statt jedes eigene zu bekommen.
  const budget = newZipBudget();
  let result: Awaited<ReturnType<typeof runImport>>;
  try {
    for (const upload of uploads) {
      signal.throwIfAborted();
      const ext = extname(upload.name);
      if (!accepted.has(ext)) {
        warnings.push(`"${upload.name}" übersprungen: nicht unterstütztes Format.`);
        continue;
      }
      const bytes = upload.bytes;
      if (ext === "zip") {
        const zip = extractZip(bytes, budget);
        files.push(...zip.files);
        for (const name of zip.rejected) {
          warnings.push(`Zip-Eintrag "${name}" abgelehnt (unsicherer Pfad).`);
        }
        for (const name of zip.tooLarge) {
          warnings.push(
            `Zip-Eintrag "${name}" übersprungen (grösser als ${Math.round(
              ZIP_MAX_FILE / 1024 / 1024,
            )} MB).`,
          );
        }
        continue;
      }
      // Einzeldatei: nur der Dateiname zaehlt (nie als Pfad verwendet).
      const path =
        normalizePath(upload.name.split(/[\\/]/).pop() ?? "") ??
        `import-${files.length + 1}.${ext}`;
      files.push(fileFromBytes(isPageExt(ext) ? path : `${path}.md`, bytes));
    }

    result = await runImport({ spaceId, userId, parentId, files, signal });
  } catch (e) {
    // Der Grund wird an seiner Identitaet erkannt, nicht am Zustand der
    // Signale danach: AbortSignal.any und runImport reichen genau das
    // reason-Objekt durch, das abgebrochen hat. Die Ruecknahme kann
    // dauern (ihre Transaktion allein bis zu 30 s); laeuft in der Zeit die
    // Zeitgrenze ab oder schliesst der Browser, war trotzdem der echte
    // Fehler der Grund und gehoert so gemeldet und protokolliert.
    const cause = e instanceof ImportRolledBack ? e.cause : e;
    return importFailed(e, {
      spaceId,
      slug,
      warnings,
      timedOut: timer.aborted && cause === timer.reason,
      aborted: req.signal.aborted && cause === req.signal.reason,
    });
  }

  // Ab hier steht der Import. Was jetzt noch scheitert, darf nicht in
  // importFailed landen: das meldete "Es wurden keine Seiten angelegt",
  // und ein zweiter Versuch legte den Baum doppelt an.
  refreshSpace(slug, spaceId);
  log.info(
    { spaceId, userId, pages: result.pages, format: result.format },
    "Import abgeschlossen",
  );
  return NextResponse.json({
    ...result,
    warnings: [...warnings, ...result.warnings],
  });
}

/**
 * Seitenleiste des Space neu aufbauen lassen. Scheitert das, bleibt es
 * bei einem Log-Eintrag: die Antwort muss trotzdem sagen, was mit dem
 * Import geschehen ist, sonst sieht die Person einen nackten 500er und
 * weiss nicht, ob ihre Seiten stehen.
 */
function refreshSpace(slug: string, spaceId: string): void {
  try {
    revalidatePath(`/s/${slug}`, "layout");
  } catch (e) {
    log.warn({ err: e, spaceId }, "Import: Cache nicht erneuert");
  }
}

/**
 * Antwort auf einen abgebrochenen Import. Sie sagt immer, ob etwas
 * angelegt blieb: ohne das weiss die Person nicht, ob ein zweiter
 * Versuch den Baum doppelt anlegt. `warnings` sind die Hinweise, die die
 * Route selbst gesammelt hat (uebersprungene Uploads, abgelehnte
 * Zip-Eintraege).
 */
function importFailed(
  e: unknown,
  ctx: {
    spaceId: string;
    slug: string;
    warnings: string[];
    timedOut: boolean;
    aborted: boolean;
  },
): NextResponse {
  const rolledBack = e instanceof ImportRolledBack;
  const cause = rolledBack ? e.cause : e;
  if (rolledBack) {
    // Die Seiten standen eine Weile in der Datenbank; wer den Space in
    // der Zeit geladen hat, soll sie nicht aus dem Cache weiter sehen.
    refreshSpace(ctx.slug, ctx.spaceId);
    if (!e.undone) {
      // Hier bleibt ein halber Import stehen. Der Grund gehoert ins Log,
      // welcher es auch war: rollbackImport protokolliert nur, woran die
      // Ruecknahme scheiterte, nicht, warum sie noetig wurde. Bei
      // Zeitgrenze und Abbruch sagt `grund` alles; das Fehlerobjekt nur
      // bei einem echten Fehler.
      const grund = ctx.timedOut ? "zeitgrenze" : ctx.aborted ? "abbruch" : "fehler";
      log.error(
        { ...(grund === "fehler" ? { err: cause } : {}), spaceId: ctx.spaceId, grund },
        "Import abgebrochen, angelegte Seiten nicht entfernt",
      );
      return NextResponse.json(
        {
          error:
            "Import abgebrochen. Die angelegten Seiten konnten nicht wieder entfernt werden; bitte den Space prüfen, bevor du erneut importierst.",
        },
        { status: 500 },
      );
    }
  }
  if (ctx.timedOut) {
    log.warn({ spaceId: ctx.spaceId, rolledBack }, "Import: Zeitgrenze erreicht");
    return NextResponse.json(
      {
        error: `Der Import hat zu lange gedauert und wurde abgebrochen. ${NICHTS_ANGELEGT} Bitte in kleineren Teilen importieren.`,
      },
      { status: 503 },
    );
  }
  if (ctx.aborted) {
    // Die Antwort liest niemand mehr; der Log-Eintrag ist der Nachweis.
    log.info({ spaceId: ctx.spaceId, rolledBack }, "Import von der Person abgebrochen");
    return NextResponse.json(
      { error: `Import abgebrochen. ${NICHTS_ANGELEGT}` },
      { status: 400 },
    );
  }
  if (cause instanceof ImportError) {
    // Die Hinweise gehen mit, in derselben Reihenfolge wie bei einem
    // gelungenen Import. Scheitert jede Seite, nennen nur sie die Dateien
    // und den Grund; ohne sie stuende der nur im Server-Log.
    return NextResponse.json(
      {
        error: rolledBack ? `${cause.message} ${NICHTS_ANGELEGT}` : cause.message,
        warnings: [...ctx.warnings, ...cause.warnings],
      },
      { status: 400 },
    );
  }
  log.error({ err: cause, spaceId: ctx.spaceId }, "Import fehlgeschlagen");
  return NextResponse.json(
    {
      error: `Import fehlgeschlagen. ${NICHTS_ANGELEGT} Bitte Datei prüfen und erneut versuchen.`,
    },
    { status: 500 },
  );
}
