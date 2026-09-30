// Sonde fuer den Kettentest im CI-Job docker (Schritt "Proxy-Kette").
//
// Laeuft ohne Abhaengigkeiten mit dem Node des App-Images
// (`docker run --entrypoint node <image> /sonde/sonde.mjs ...`), jeweils in
// einem eigenen Container mit fester Adresse im Netz der Kette. So hat
// jeder Aufruf eine echte, eigene Client-Adresse; der Runner selbst hat
// nur eine.
//
// Umgebung:
//   SONDE_ZIEL    Basis-URL (Vorgabe http://vorproxy, also durch nginx;
//                 https://proxy:443 geht am vorgelagerten Proxy vorbei)
//   SONDE_HOST    Host-Kopf (Vorgabe localhost:7891, wie APP_URL im Job)
//   SONDE_ORIGIN  Origin der Formulare (Vorgabe https://localhost:7891)
//
// Befehle (Ausgabe: je Anfrage ein Wort, durch Leerzeichen getrennt):
//   login-falsch <praefix> <n> [xff]
//       n Anmeldungen mit falschem Passwort fuer <praefix>-<i>@example.test,
//       ohne JavaScript: das Formular von /login lesen und mit seinen
//       versteckten Feldern abschicken, wie ein Browser ohne Skript.
//       Ausgabe je Versuch: falsch | gebremst | <Status>
//   sso-start <n> [xff]
//       n Aufrufe von /api/auth/oidc/start ohne Weiterleitung.
//       Ausgabe: idp | throttled | error | disabled | <Status>
//   collab-upgrade <n>
//       n rohe WebSocket-Upgrades an /collab/sonde, Socket sofort zu.
//       Ausgabe: 101 | <Status>
//
// [xff] setzt X-Forwarded-For auf diesen Wert, wie ein Client, der seine
// Adresse faelschen will; nginx haengt daran an.

import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";

const ZIEL = new URL(process.env.SONDE_ZIEL ?? "http://vorproxy");
const HOST = process.env.SONDE_HOST ?? "localhost:7891";
const ORIGIN = process.env.SONDE_ORIGIN ?? "https://localhost:7891";

/** Eine Anfrage mit vollem Zugriff auf die Kopfzeilen (fetch setzt Host selbst). */
function anfrage(pfad, { method = "GET", headers = {}, body } = {}) {
  const url = new URL(pfad, ZIEL);
  const modul = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = modul.request(
      url,
      {
        method,
        headers: { host: HOST, ...headers },
        // Caddys eigene CA; die Sonde prueft die Kette, nicht das Zertifikat.
        rejectUnauthorized: false,
        servername: HOST.split(":")[0],
      },
      (res) => {
        const teile = [];
        res.on("data", (d) => teile.push(d));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(teile).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`Zeitueberschreitung: ${method} ${url}`)));
    if (body) req.write(body);
    req.end();
  });
}

function xffKopf(xff) {
  return xff ? { "x-forwarded-for": xff } : {};
}

const ENTITAETEN = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'" };
function entschluesseln(text) {
  return text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, n) => ENTITAETEN[n]);
}

function attribute(tag) {
  const a = {};
  for (const m of tag.matchAll(/([\w:$-]+)="([^"]*)"/g)) a[m[1].toLowerCase()] = entschluesseln(m[2]);
  return a;
}

/** Das Anmeldeformular: versteckte Felder und Ziel. */
async function anmeldeformular(xff) {
  const seite = await anfrage("/login", { headers: xffKopf(xff) });
  if (seite.status !== 200) throw new Error(`/login antwortet ${seite.status}`);
  for (const [, kopf, inhalt] of seite.text.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/g)) {
    const felder = [...inhalt.matchAll(/<input[^>]*>/g)].map((m) => attribute(m[0]));
    const namen = felder.map((f) => f.name);
    if (!namen.includes("email") || !namen.includes("password")) continue;
    const versteckt = felder.filter((f) => f.type === "hidden" && f.name);
    const ziel = attribute(`<form${kopf}>`).action || "/login";
    return { versteckt, ziel: ziel.startsWith("/") ? ziel : "/login" };
  }
  throw new Error("kein Anmeldeformular auf /login gefunden");
}

function multipart(felder) {
  const grenze = `----sonde${randomBytes(8).toString("hex")}`;
  const teile = felder.map(
    ([name, wert]) =>
      `--${grenze}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${wert}\r\n`,
  );
  return { grenze, body: Buffer.from(`${teile.join("")}--${grenze}--\r\n`) };
}

async function loginFalsch(praefix, n, xff) {
  const formular = await anmeldeformular(xff);
  const aus = [];
  for (let i = 1; i <= n; i++) {
    const { grenze, body } = multipart([
      ...formular.versteckt.map((f) => [f.name, f.value ?? ""]),
      ["email", `${praefix}-${i}@example.test`],
      ["password", "falsch-falsch"],
    ]);
    const r = await anfrage(formular.ziel, {
      method: "POST",
      headers: {
        ...xffKopf(xff),
        origin: ORIGIN,
        "content-type": `multipart/form-data; boundary=${grenze}`,
        "content-length": String(body.length),
      },
      body,
    });
    if (r.text.includes("Zu viele Versuche")) aus.push("gebremst");
    else if (r.text.includes("Falsche Zugangsdaten")) aus.push("falsch");
    else aus.push(String(r.status));
  }
  return aus;
}

async function ssoStart(n, xff) {
  const aus = [];
  for (let i = 0; i < n; i++) {
    const r = await anfrage("/api/auth/oidc/start", { headers: xffKopf(xff) });
    const ort = String(r.headers.location ?? "");
    const sso = /[?&]sso=([a-z]+)/.exec(ort)?.[1];
    if (sso) aus.push(sso);
    else if (r.status >= 300 && r.status < 400 && ort) aus.push("idp");
    else aus.push(String(r.status));
  }
  return aus;
}

function collabUpgrade() {
  const url = new URL("/collab/sonde", ZIEL);
  const modul = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = modul.request(url, {
      headers: {
        host: HOST,
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": randomBytes(16).toString("base64"),
        origin: ORIGIN,
      },
      rejectUnauthorized: false,
      servername: HOST.split(":")[0],
    });
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      resolve("101");
    });
    req.on("response", (res) => {
      res.resume();
      resolve(String(res.statusCode));
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("Zeitueberschreitung beim Upgrade")));
    req.end();
  });
}

async function collabUpgrades(n) {
  const aus = [];
  for (let i = 0; i < n; i++) aus.push(await collabUpgrade());
  return aus;
}

const [befehl, ...args] = process.argv.slice(2);
let ergebnis;
switch (befehl) {
  case "login-falsch":
    ergebnis = await loginFalsch(args[0], Number(args[1]), args[2]);
    break;
  case "sso-start":
    ergebnis = await ssoStart(Number(args[0]), args[1]);
    break;
  case "collab-upgrade":
    ergebnis = await collabUpgrades(Number(args[0]));
    break;
  default:
    console.error(`unbekannter Befehl: ${befehl ?? "(keiner)"}`);
    process.exit(2);
}
console.log(ergebnis.join(" "));
