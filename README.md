# dokunc

Selbst gehostetes, kollaboratives Team-Wiki — ein von [Docmost](https://docmost.com)
inspirierter Klon. Next.js-Fullstack mit Echtzeit-Co-Editing (Yjs/CRDT).

Architektur & Designentscheidungen: siehe [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Features

- Auth & Benutzer (Invite-only-Registrierung, erste Person = Admin)
- Spaces mit Rollen/Berechtigungen (OWNER/ADMIN/MEMBER/VIEWER)
- Verschachtelter Seitenbaum + Rich-Editor (Slash-Menü „/", Tabellen,
  Aufgabenlisten, Bilder, Callouts, Mermaid-Diagramme, YouTube-Embeds,
  Excalidraw-Zeichnungen, draw.io-Diagramme)
- Echtzeit-Kollaboration mit Live-Cursorn (Yjs + Hocuspocus)
- **Wiki-Links** `[[Seite]]` mit Vorschlags-Popup + **Backlinks**
- **Kommentare** (textverankerte Threads) + **@-Mentions** +
  Benachrichtigungen
- **KI**: „Frag dein Wiki" (RAG mit Quellen, Claude API) + KI-Aktionen
  im Editor (Verbessern, Zusammenfassen, Übersetzen, Weiterschreiben) —
  optional, aktiviert per `ANTHROPIC_API_KEY`
- Postgres-Volltextsuche, Versionsverlauf, Papierkorb
- **Audit-Log** über sicherheitsrelevante Ereignisse (Anmeldungen,
  Rollenwechsel, Einladungen, Löschungen) mit Ansicht unter `/admin/audit`
- Export: Markdown, HTML und **PDF** (Gotenberg im Docker-Setup
  enthalten; ohne Gotenberg über die Druckansicht des Browsers)

## Stack

Next.js 16 · React 19 · TypeScript · Prisma 7 (+ pg-Adapter) · PostgreSQL 16 ·
Redis · TipTap 3 · Yjs · Hocuspocus 4 · Tailwind CSS 4 · Node 26 · pnpm.

## Schnellstart mit Docker (empfohlen)

`APP_SECRET` ist Pflicht (sonst startet der Container bewusst nicht):

```bash
cp .env.example .env
# In .env ein starkes Secret setzen:  openssl rand -base64 48
docker compose up --build
```

Danach:

- App: <https://localhost> (TLS über den Caddy-Proxy)
- Collab läuft unter `wss://localhost/collab` (vom Proxy geroutet)

Hinweise:

- TLS nutzt Caddys **interne CA** (`localhost`). Der Browser zeigt anfangs
  eine Zertifikatswarnung — für internen/VPN-Betrieb ok, oder die Caddy-Root-CA
  importieren. Für eine echte Domain `SITE_ADDRESS=wiki.example.com` setzen
  und in der `Caddyfile` `tls internal` entfernen (auto-HTTPS via Let's Encrypt).
- **Nur der Proxy ist exponiert**, gebunden an `127.0.0.1` (kein LAN-Zugriff).
  App/DB/Redis sind nur im internen Docker-Netz erreichbar.
- Der App-Container läuft als **non-root**. Migrationen laufen automatisch.
  Daten liegen in den Volumes `db_data`, `redis_data`, `uploads`.

**Backups:** `./scripts/backup.sh` sichert Datenbank + Uploads nach `backups/`
(Restore-Befehle gibt das Skript aus).

## Lokale Entwicklung (ohne Docker)

Voraussetzungen: Node 26 (`.nvmrc`), pnpm, lokal laufendes PostgreSQL 16 + Redis.

```bash
nvm use                 # Node 26
pnpm install
cp .env.example .env     # Werte anpassen
pnpm db:migrate          # Schema + Migrationen
pnpm dev                 # web :3000 + collab :3001
```

## Tests

```bash
pnpm lint             # ESLint über das ganze Monorepo
pnpm test             # Unit-Tests (Vitest)
pnpm test:integration # Autorisierungstests gegen die echte Datenbank
pnpm test:e2e         # Playwright-E2E: kompletter Editor-Pfad inkl.
                      # Realtime-Sync (leert die DB! Nur gegen Dev-DB laufen lassen)
```

Die Integrationstests prüfen, dass eine Seiten- oder Versions-ID aus einem
Formular niemals einen fremden Space trifft. Sie brauchen eine erreichbare
Datenbank aus `.env` und legen ihre eigenen Datensätze an (und wieder ab);
sie leeren nichts.

Der E2E-Lauf startet Web + Collab selbst (bzw. nutzt bereits laufende
Server) und erwartet Postgres + Redis aus `.env`. In Umgebungen mit
vorinstalliertem Chromium: `PW_EXECUTABLE_PATH=/pfad/zu/chromium` setzen.
CI führt beide Suiten automatisch aus (`.github/workflows/ci.yml`).

## Sicherheit

Kurz, was die App bewusst tut:

- **Sitzung** im httpOnly-Cookie; der Collab-WebSocket bekommt stattdessen
  ein kurzlebiges, an eine Seite gebundenes Ticket.
- **Space-Bindung** aller Schreibzugriffe: IDs aus Formularen werden gegen
  den Space geprüft, in dem die Person tatsächlich Rechte hat.
- **Rollen**: die eigene Rolle lässt sich nicht ändern, OWNER vergibt nur
  ein OWNER, der letzte OWNER bleibt bestehen.
- **Registrierung** ausschliesslich mit gültigem Einladungstoken; die
  blosse Kenntnis einer eingeladenen Adresse genügt nicht.
- **Uploads** gehören einem Space und werden nur an dessen Mitglieder
  ausgeliefert.
- **Rate-Limits** pro Konto und pro IP. Die IP stammt aus
  `X-Forwarded-For`, ausgewertet gemäss `TRUSTED_PROXY_HOPS` — hinter dem
  mitgelieferten Caddy setzt der Proxy den Header selbst.
- **Audit-Log** für Anmeldungen, Rollenwechsel, Einladungen und Löschungen.

## Projektstruktur

```
apps/web      Next.js (UI, Auth, API, Editor)
apps/collab   Hocuspocus WebSocket-Server (Yjs-Persistenz)
packages/db   Prisma-Schema + generierter Client (geteilt)
packages/editor  Geteilte TipTap-Extensions
e2e/          Playwright-E2E-Tests
```
