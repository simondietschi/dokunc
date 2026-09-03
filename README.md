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
- Navigation: Seiten per Drag and Drop im Seitenbaum verschieben und
  sortieren (oder per Dialog „Verschieben nach…“), Brotkrumen über dem
  Titel, Inhaltsverzeichnis aus den Überschriften der Seite
- Echtzeit-Kollaboration mit Live-Cursorn (Yjs + Hocuspocus)
- **Wiki-Links** `[[Seite]]` mit Vorschlags-Popup + **Backlinks**
- **Kommentare** (textverankerte Threads) + **@-Mentions** +
  Benachrichtigungen, optional auch **per Mail** (sofort gebündelt oder
  als tägliche Zusammenfassung, pro Person im Konto einstellbar)
- **KI**: „Frag dein Wiki" (RAG mit Quellen, Claude API) + KI-Aktionen
  im Editor (Verbessern, Zusammenfassen, Übersetzen, Weiterschreiben) —
  optional, aktiviert per `ANTHROPIC_API_KEY`
- **Anhänge** beliebigen Typs (PDF, Office, Archive, Medien) per
  Slash-Befehl „Datei", Drag-and-drop oder Einfügen; Anhangsliste unter
  der Seite. **Zugriffsschutz**: jede Datei ist an ihren Space gebunden
  und nur für dessen Mitglieder abrufbar (Bilder inline, alles andere
  als Download; Limit per `MAX_UPLOAD_MB`, Default 50 MB)
- **Seitenvorlagen**: eigene Vorlagen je Space plus fünf Standardvorlagen
  (Meeting-Notizen, ADR, Runbook, Projektbrief, Wochenbericht), Picker
  neben „Neue Seite", **Seiten duplizieren** (optional mit Unterseiten),
  „Als Vorlage speichern"
- Postgres-Volltextsuche, Versionsverlauf mit **Versionsvergleich**
  (Zeilen- und Wort-Diff gegen den aktuellen Stand oder die vorherige
  Version, Vorschau, Wiederherstellen), Papierkorb
- **Favoriten** (Stern in der Seitenkopfzeile, Abschnitt in der Sidebar,
  Sprungziele in der Palette), **Zuletzt besucht** und ein
  **Space-Dashboard** (Kennzahlen, zuletzt besuchte, favorisierte und
  zuletzt geänderte Seiten)
- Export: Markdown, HTML und **PDF** (Gotenberg im Docker-Setup
  enthalten; ohne Gotenberg über die Druckansicht des Browsers)
- **Space-Einstellungen**: Name, Beschreibung und Emoji-Icon (Sidebar und
  Space-Übersicht), Mitgliederverwaltung, Space verlassen (nicht als
  letzter Owner), Gefahrenzone: Space löschen (nur Owner, Bestätigung
  durch Eintippen des Namens; Anhänge werden von der Platte entfernt)
- **Import** (Menüpunkt „Importieren“, ab Rolle MEMBER) mit drei Formaten:
  - **Markdown**: einzelne Dateien (.md/.markdown/.txt/.html) oder ein Zip
    mit Ordnern. Ordner werden Elternseiten; `index.md`/`README.md` oder
    eine gleichnamige Datei neben dem Ordner liefert deren Inhalt. Titel aus
    Frontmatter `title:`, erster H1 oder Dateiname. Unterstützt GFM
    (Tabellen, Aufgabenlisten), Mermaid-Codeblöcke, GitHub-Hinweise
    (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!CAUTION]` werden Callouts),
    `[[Wiki-Links]]`.
  - **Confluence**: HTML-Export eines Bereichs (Zip). Hierarchie und
    Reihenfolge aus `index.html`, sonst aus den Breadcrumbs; Info-/Hinweis-/
    Warn-/Tipp-Makros werden Callouts, Code-Makros Codeblöcke (Sprache aus
    `brush`), Aufgabenlisten und Tabellen bleiben erhalten, Bilder aus
    `attachments/` werden gespeichert.
  - **Notion**: Export als „Markdown & CSV“ oder „HTML“ inklusive
    Unterseiten (Zip). Die 32-stelligen IDs in Datei- und Ordnernamen werden
    entfernt, To-do-Listen, Callouts und Toggle-Blöcke abgebildet,
    Datenbanken (CSV) werden mit Hinweis übersprungen.
  - Relative Links zwischen importierten Dateien werden zu Wiki-Links
    (inkl. Backlinks), relative und `data:`-Bilder als Anhänge gespeichert
    (nur PNG/JPG/GIF/WebP, Magic-Byte-Prüfung), externe Bilder bleiben
    verlinkt. Es wird nie Roh-HTML gespeichert — alles läuft durch das
    Editor-Schema. Limits: `IMPORT_MAX_MB` (Default 100) pro Upload,
    2000 Dateien / 500 MB entpackt pro Zip, 2000 Seiten pro Import,
    5 Importe pro 10 Minuten. Fehler einzelner Dateien werden als Hinweise
    gesammelt, der Rest wird importiert.

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
alle bestehenden Sitzungen). Weitere Optionen — SMTP für Einladungs- und
Benachrichtigungs-Mails (`MAIL_DISPATCH_INTERVAL_S`, `DIGEST_HOUR_UTC`),
`ANTHROPIC_API_KEY` für die KI-Funktionen, `MAX_UPLOAD_MB` für das
Upload-Limit — siehe `.env.example`.

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
