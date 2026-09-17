import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getAppSecret } from "./secret";

/**
 * Zwischenzustand der laufenden SSO-Anmeldungen.
 *
 * `state`, `nonce` und der PKCE-Verifier müssen den Weg zum Anbieter
 * und zurück überstehen, dürfen aber nirgends sonst auftauchen. Also
 * ein eigenes, kurzlebiges httpOnly-Cookie mit eigener Audience —
 * dasselbe Muster wie beim zweiten Faktor.
 *
 * Im Cookie steht eine Liste und nicht ein einzelner Fluss: vorher
 * überschrieb jede neu begonnene Anmeldung den Zustand der vorigen und
 * jeder Rücksprung löschte das ganze Cookie. Zwei Anmeldungen in zwei
 * Tabs — beim Anbieter ein durchaus üblicher Vorgang, etwa nach einem
 * versehentlichen zweiten Klick — endeten damit beide im Fehler
 * (sso=state für die zuerst zurückkommende, sso=expired für die
 * andere), obwohl mit beiden alles in Ordnung war.
 */
const COOKIE = "dokunc_oidc";
const AUDIENCE = "dokunc-oidc";
const TTL_SECONDS = 600;

/**
 * Höchstzahl gleichzeitig offener Flüsse.
 *
 * Nach oben deckeln, weil jeder Eintrag rund 200 Zeichen wiegt und das
 * Cookie insgesamt unter der 4-KB-Grenze der Browser bleiben muss —
 * darüber wirft mancher Server die Anfrage ganz weg. Der jüngste Fluss
 * steht vorne, der älteste fällt heraus.
 */
const MAX_FLOWS = 4;

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!_secret) _secret = new TextEncoder().encode(getAppSecret());
  return _secret;
}

export type OidcFlow = {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
};

/** Ein Fluss samt Beginn (Sekunden seit Epoche). */
export type StoredFlow = OidcFlow & { begonnen: number };

/**
 * Liest die Liste aus der Cookie-Nutzlast und lässt abgelaufene sowie
 * unvollständige Einträge weg. Rein, damit prüfbar: alles drumherum
 * hängt an `cookies()` und ist im Unit-Lauf nicht aufrufbar.
 *
 * Jeder Eintrag trägt seinen eigenen Beginn, obwohl das JWT schon ein
 * `exp` hat. Das `exp` gilt für die ganze Liste und rückt bei jedem
 * Schreiben nach vorn — ohne eigenen Zeitstempel je Eintrag würde eine
 * frisch begonnene Anmeldung die Laufzeit aller älteren mitverlängern,
 * und ein vor einer Stunde angefangener Fluss bliebe gültig.
 */
export function readFlowList(
  payload: unknown,
  nowSeconds: number,
): StoredFlow[] {
  const raw = (payload as { flows?: unknown } | null)?.flows;
  if (!Array.isArray(raw)) return [];

  const out: StoredFlow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { state, nonce, verifier, next, begonnen } = entry as Record<
      string,
      unknown
    >;
    if (
      typeof state !== "string" ||
      !state ||
      typeof nonce !== "string" ||
      typeof verifier !== "string" ||
      typeof begonnen !== "number" ||
      !Number.isFinite(begonnen)
    ) {
      continue;
    }
    if (nowSeconds - begonnen >= TTL_SECONDS) continue;
    out.push({
      state,
      nonce,
      verifier,
      // Fehlt das Ziel, geht es zur Übersicht — wie vor der Liste auch.
      next: typeof next === "string" ? next : "/spaces",
      begonnen,
    });
  }
  return out;
}

/**
 * Setzt einen neuen Fluss vorne ein und deckelt die Liste. Rein, damit
 * prüfbar.
 *
 * Ein bereits vorhandener Eintrag mit demselben `state` fliegt heraus:
 * `state` ist der Schlüssel, unter dem der Rücksprung ihn wiederfindet,
 * und zwei Einträge dazu wären nicht mehr eindeutig. In der Praxis
 * kommt das nicht vor (32 zufällige Bytes), die Eindeutigkeit soll aber
 * nicht am Zufall hängen.
 */
export function addFlowToList(
  list: StoredFlow[],
  flow: OidcFlow,
  nowSeconds: number,
): StoredFlow[] {
  return [
    { ...flow, begonnen: nowSeconds },
    ...list.filter((f) => f.state !== flow.state),
  ].slice(0, MAX_FLOWS);
}

function jetztSekunden(): number {
  return Math.floor(Date.now() / 1000);
}

async function readList(): Promise<StoredFlow[]> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return [];
  try {
    const { payload } = await jwtVerify(token, secret(), {
      audience: AUDIENCE,
    });
    return readFlowList(payload, jetztSekunden());
  } catch {
    return [];
  }
}

async function writeList(list: StoredFlow[]): Promise<void> {
  const store = await cookies();
  // Nichts mehr offen: das Cookie ganz weg statt eine leere Liste
  // herumtragen.
  if (list.length === 0) {
    store.delete(COOKIE);
    return;
  }

  const token = await new SignJWT({ flows: list })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());

  store.set(COOKIE, token, {
    httpOnly: true,
    // lax und nicht strict: der Anbieter leitet von aussen zurück, und
    // bei strict käme das Cookie bei genau dieser Anfrage nicht mit.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/** Merkt sich einen neu begonnenen Fluss, ohne die übrigen anzutasten. */
export async function startOidcFlow(flow: OidcFlow): Promise<void> {
  const jetzt = jetztSekunden();
  await writeList(addFlowToList(await readList(), flow, jetzt));
}

/** Alle noch offenen Flüsse, jüngster zuerst. */
export async function readOidcFlows(): Promise<StoredFlow[]> {
  return readList();
}

/**
 * Nimmt genau den Fluss zu diesem `state` heraus und gibt ihn zurück.
 *
 * Herausnehmen und nicht bloss lesen: der Zustand gilt einmal, sonst
 * liesse sich ein abgefangener Rücksprung ein zweites Mal einspielen.
 * Die anderen Einträge bleiben stehen — daran scheiterten zwei
 * parallele Anmeldungen früher.
 */
export async function consumeOidcFlow(state: string): Promise<OidcFlow | null> {
  const list = await readList();
  const treffer = list.find((f) => f.state === state);
  if (!treffer) return null;
  await writeList(list.filter((f) => f.state !== state));
  return treffer;
}
