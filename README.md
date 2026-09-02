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
- **Codeblöcke mit Syntax-Highlighting** (Sprachauswahl, Kopieren-Knopf;
  auch im HTML/PDF-Export), **Drag Handle** zum Verschieben von Blöcken
- **Inhaltsverzeichnis** aus den Überschriften (rechte Leiste bzw.
  Popover, Anker-Links `#abschnitt`, im Export eingebettet)
- **Seiten-Icons** (Emoji) und **Titelbilder** (Verlauf oder Upload),
  sichtbar in Sidebar, Wiki-Links, Suche und Export
- **Vorlagen**: eingebaute (Meeting, ADR, Onboarding, Postmortem,
  Anleitung) und eigene pro Space („Als Vorlage speichern")
- Echtzeit-Kollaboration mit Live-Cursorn (Yjs + Hocuspocus)
- **Wiki-Links** `[[Seite]]` mit Vorschlags-Popup + **Backlinks**
- **Kommentare** (textverankerte Threads) + **@-Mentions** +
  Benachrichtigungen
- **KI**: „Frag dein Wiki" (RAG mit Quellen, Claude API) + KI-Aktionen
  im Editor (Verbessern, Zusammenfassen, Übersetzen, Weiterschreiben) —
  optional, aktiviert per `ANTHROPIC_API_KEY`
- Postgres-Volltextsuche, Versionsverlauf, Papierkorb
- Export: Markdown, HTML und **PDF** (Gotenberg im Docker-Setup
  enthalten; ohne Gotenberg über die Druckansicht des Browsers)

## Stack

Next.js 16 · React 19 · TypeScript · Prisma 7 (+ pg-Adapter) · PostgreSQL 16 ·
Redis · TipTap 3 · Yjs · Hocuspocus 4 · Tailwind CSS 4 · Node 26 · pnpm.

## Schnellstart mit Docker (empfohlen)

Klonen, starten — mehr ist nicht nötig, keine `.env` erforderlich:

```bash
git clone https://github.com/simondietschi/dokunc.git
cd dokunc
docker compose up -d
```

Der erste Start baut das Image (einige Minuten) und richtet alles ein:
Datenbank-Migrationen laufen automatisch, ein zufälliges `APP_SECRET` wird
erzeugt und im Volume `app_data` abgelegt (überlebt Neustarts und Updates).

Danach:

- App: <https://localhost> (TLS über den Caddy-Proxy)
- Die erste Registrierung wird automatisch Instanz-Admin; danach ist die
  Anmeldung nur noch per Einladung möglich.
- Status: `docker compose ps` · Logs: `docker compose logs -f app`
- Stoppen: `docker compose down` (Daten bleiben) — Update:
  `git pull && docker compose up -d --build`

Hinweise:

- TLS nutzt Caddys **interne CA** (`localhost`). Der Browser zeigt anfangs
  eine Zertifikatswarnung — für internen/VPN-Betrieb ok, oder die Caddy-Root-CA
  importieren.
- **Nur der Proxy ist exponiert**, gebunden an `127.0.0.1` (kein LAN-Zugriff).
  App/DB/Redis sind nur im internen Docker-Netz erreichbar.
- Der App-Container läuft als **non-root**. Daten liegen in den Volumes
  `db_data`, `redis_data`, `uploads`, `app_data`.

### Eigene Domain / Produktionsbetrieb

Eine `.env` neben der `docker-compose.yml` genügt — ein Rebuild ist dafür
nicht nötig, die Adressen werden zur Laufzeit ausgewertet:

```env
SITE_ADDRESS=wiki.example.com
APP_URL=https://wiki.example.com
APP_SECRET=<openssl rand -base64 48>
POSTGRES_PASSWORD=<eigenes Passwort>
```

Dann `docker compose up -d`. In der `Caddyfile` `tls internal` entfernen,
damit Caddy ein Let's-Encrypt-Zertifikat holt. Ein selbst gesetztes
`APP_SECRET` hat Vorrang vor dem automatisch erzeugten (Wechsel beendet
alle bestehenden Sitzungen). Weitere Optionen — SMTP für Einladungs-Mails,
`ANTHROPIC_API_KEY` für die KI-Funktionen — siehe `.env.example`.

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
pnpm test        # Unit-Tests (Vitest, 44 Tests)
pnpm test:e2e    # Playwright-E2E: kompletter Editor-Pfad inkl.
                 # Realtime-Sync (leert die DB! Nur gegen Dev-DB laufen lassen)
```

Der E2E-Lauf startet Web + Collab selbst (bzw. nutzt bereits laufende
Server) und erwartet Postgres + Redis aus `.env`. In Umgebungen mit
vorinstalliertem Chromium: `PW_EXECUTABLE_PATH=/pfad/zu/chromium` setzen.
CI führt beide Suiten automatisch aus (`.github/workflows/ci.yml`).

## Projektstruktur

```
apps/web      Next.js (UI, Auth, API, Editor)
apps/collab   Hocuspocus WebSocket-Server (Yjs-Persistenz)
packages/db   Prisma-Schema + generierter Client (geteilt)
packages/editor  Geteilte TipTap-Extensions
e2e/          Playwright-E2E-Tests
```
