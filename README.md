# dokunc

Selbst gehostetes, kollaboratives Team-Wiki — ein von [Docmost](https://docmost.com)
inspirierter Klon. Next.js-Fullstack mit Echtzeit-Co-Editing (Yjs/CRDT).

Architektur & Designentscheidungen: siehe [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Features

- Auth & Benutzer (Invite-only-Registrierung, erste Person = Admin)
- **Single Sign-on** über OIDC (Authorization Code mit PKCE), optional
  zuschaltbar; die Anmeldung mit Passwort bleibt immer bestehen
- Spaces mit Rollen/Berechtigungen (OWNER/ADMIN/MEMBER/VIEWER)
- **Gruppen**: Personengruppen im Admin-Bereich, pro Space mit eigener
  Rolle; es gilt immer die stärkste Rolle
- **Geschützte Seiten**: eine Seite (samt Unterseiten) nur für
  ausgewählte Personen und Gruppen sichtbar
- Verschachtelter Seitenbaum + Rich-Editor (Slash-Menü „/", Tabellen,
  Aufgabenlisten, Bilder mit Alternativtext, Breite und Bildunterschrift,
  Code-Blöcke mit Syntax-Hervorhebung, aufklappbare Abschnitte, Callouts,
  Mermaid-Diagramme, YouTube-Embeds, Excalidraw-Zeichnungen,
  draw.io-Diagramme); Tab rückt im Codeblock ein, Tabellen-Werkzeuge
  (Zeile/Spalte einfügen und löschen, Kopfzeile, Tabelle löschen)
  erscheinen in der Toolbar, sobald der Cursor in einer Tabelle steht;
  Links öffnen im Lesemodus per Klick, beim Bearbeiten per Cmd/Ctrl+Klick
- Block-Griff zum Verschieben, Duplizieren und Löschen; Gliederung der
  Seite, Anker an jeder Überschrift, Wortzähler
- Navigation: Seiten per Drag and Drop im Seitenbaum verschieben und
  sortieren (oder per Dialog „Verschieben nach…"), Brotkrumen über dem
  Titel, Inhaltsverzeichnis aus den Überschriften der Seite
- Seiten-Symbol und Titelbild
- Markdown einfügen und importieren
- Echtzeit-Kollaboration mit Live-Cursorn (Yjs + Hocuspocus)
- **Wiki-Links** `[[Seite]]` mit Vorschlags-Popup + **Backlinks**
- **Kommentare**: textverankerte Threads und Kommentare zur ganzen
  Seite, bearbeitbar, mit Benachrichtigung an Beteiligte; auch die
  VIEWER-Rolle darf mitreden. Dazu **@-Mentions** und die Glocke, die
  sich live aktualisiert. Optional **per Mail**, sofort gebündelt oder
  als tägliche Zusammenfassung, pro Person im Konto einstellbar; Seiten
  lassen sich einzeln abonnieren
- **KI**: „Frag dein Wiki" (RAG mit Quellen, Claude API) + KI-Aktionen
  im Editor (Verbessern, Zusammenfassen, Übersetzen, Weiterschreiben) —
  optional, aktiviert per `ANTHROPIC_API_KEY`
- **Anhänge** beliebigen Typs (PDF, Office, Archive, Medien) per
  Slash-Befehl „Datei", Drag-and-drop oder Einfügen; Anhangsliste unter
  der Seite. **Zugriffsschutz**: jede Datei ist an ihren Space und ihre
  Seite gebunden und nur für Berechtigte abrufbar (Bilder inline, alles
  andere als Download; Limit per `MAX_UPLOAD_MB`, Default 50 MB)
- **Seitenvorlagen**: eigene Vorlagen je Space plus fünf Standardvorlagen
  (Meeting-Notizen, ADR, Runbook, Projektbrief, Wochenbericht), Picker
  neben „Neue Seite", **Seiten duplizieren** (optional mit Unterseiten),
  „Als Vorlage speichern"
- Postgres-Volltextsuche, **Versionsverlauf** mit Versionsvergleich
  (Zeilen- und Wort-Diff gegen den aktuellen Stand oder die vorherige
  Version, Vorschau vor dem Wiederherstellen), Papierkorb
- **Favoriten** (Stern in der Seitenkopfzeile, Abschnitt in der Sidebar,
  Sprungziele in der Palette), **Zuletzt besucht** und ein
  **Space-Dashboard** (Kennzahlen, zuletzt besuchte, favorisierte und
  zuletzt geänderte Seiten)
- **Offline-Puffer**: Änderungen ohne Netz bleiben auf dem Gerät und
  gehen beim Neuladen nicht verloren
- **Space-Einstellungen**: umbenennen, verlassen, offene Spaces zum
  Beitreten
- **Audit-Log** über sicherheitsrelevante Ereignisse (Anmeldungen,
  Rollenwechsel, Einladungen, Löschungen) mit Ansicht unter `/admin/audit`
- **Angemeldete Geräte** einzeln beenden, „angemeldet bleiben" optional
- **Zwei-Faktor-Anmeldung** (TOTP) mit QR-Code für Authenticator-Apps
  und einmalig gültigen Wiederherstellungscodes
- **Freigabelinks**: eine Seite (auf Wunsch mit Unterseiten) ohne Konto
  lesbar machen, mit Ablauf und jederzeit widerrufbar
- **Datenauskunft und Kontolöschung** im Konto-Bereich
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
    2000 Dateien / 500 MB entpackt pro Zip (32 MB pro Zip-Eintrag,
    Seitendateien bis 5 MB), 2000 Seiten pro Import, 5 Importe pro
    10 Minuten. Fehler einzelner Dateien werden als Hinweise
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

- App: <https://localhost:7891> (TLS über den Caddy-Proxy; Port über `APP_PORT` in `.env` änderbar)
- Die erste Registrierung wird automatisch Instanz-Admin; danach ist die
  Anmeldung nur noch per Einladung möglich.
- Status: `docker compose ps` · Logs: `docker compose logs -f app`
- Stoppen: `docker compose down` (Daten bleiben) — Update:
  `git pull && docker compose up -d --build`

Hinweise:

- TLS nutzt Caddys **interne CA** (`localhost`). Der Browser zeigt anfangs
  eine Zertifikatswarnung — für internen/VPN-Betrieb ok, oder die Caddy-Root-CA
  importieren.
- **Nur der Proxy ist exponiert**, gebunden an `127.0.0.1:7891` (kein LAN-Zugriff).
  App/DB/Redis sind nur im internen Docker-Netz erreichbar.
- Der App-Container läuft als **non-root**. Daten liegen in den Volumes
  `db_data`, `redis_data`, `uploads`, `app_data`.

### Eigene Domain / Produktionsbetrieb

Eine `.env` neben der `docker-compose.yml` genügt — ein Rebuild ist dafür
nicht nötig, die Adressen werden zur Laufzeit ausgewertet:

```env
SITE_ADDRESS=wiki.example.com
APP_URL=https://wiki.example.com
APP_PORT=443
APP_SECRET=<openssl rand -base64 48>
POSTGRES_PASSWORD=<eigenes Passwort>
```

Dann `docker compose up -d`. In der `Caddyfile` `tls internal` entfernen,
damit Caddy ein Let's-Encrypt-Zertifikat holt (dafür muss Caddy zusätzlich
auf Port 80 erreichbar sein, also `"127.0.0.1:80:80"` bzw. ohne
`127.0.0.1` beim Proxy unter `ports` ergänzen). Ein selbst gesetztes
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
pnpm lint             # ESLint über das ganze Monorepo
pnpm test             # Unit-Tests (Vitest)
pnpm test:integration # Autorisierungstests gegen die echte Datenbank
pnpm test:e2e         # Playwright-E2E: kompletter Editor-Pfad inkl.
                      # Realtime-Sync (leert die DB! Nur gegen Dev-DB laufen lassen)
```

Die Integrationstests prüfen, was in Abfragebedingungen steckt statt im
Code: dass eine Seiten- oder Versions-ID aus einem Formular niemals einen
fremden Space trifft, dass ein TOTP-Zeitschritt wie ein
Wiederherstellungscode genau einmal gilt (auch bei gleichzeitigen
Versuchen), und dass eine geschützte Seite genau denen sichtbar ist, die
sie sehen dürfen — direkt, über eine Gruppe oder als Space-Verwaltung. Sie brauchen eine erreichbare Datenbank aus `.env` und legen
ihre eigenen Datensätze an (und wieder ab); sie leeren nichts.

Der E2E-Lauf startet Web + Collab selbst (bzw. nutzt bereits laufende
Server) und erwartet Postgres + Redis aus `.env`. In Umgebungen mit
vorinstalliertem Chromium: `PW_EXECUTABLE_PATH=/pfad/zu/chromium` setzen.
CI führt beide Suiten automatisch aus (`.github/workflows/ci.yml`).

## Sicherheit

Kurz, was die App bewusst tut:

- **Sitzung** im httpOnly-Cookie; der Collab-WebSocket bekommt stattdessen
  ein kurzlebiges, an eine Seite gebundenes Ticket.
- **Space-Bindung** aller Schreibzugriffe: IDs aus Formularen werden gegen
  den Space geprüft, in dem die Person tatsächlich Rechte hat — und gegen
  das, was sie dort sehen darf.
- **Geschützte Seiten** wirken überall gleich: Baum, Suche, Vorschläge,
  Export, Druck, KI-Antworten, Benachrichtigungen und die
  Editor-Verbindung fragen dieselbe Regel. Ein Freigabelink auf eine
  geschützte Seite entsteht gar nicht erst und ein bestehender endet,
  sobald der Schutz gesetzt wird.
- **Gruppen** geben Rollen, nehmen aber keine: die wirksame Rolle ist
  die stärkste aus eigener Mitgliedschaft und allen Gruppen. OWNER
  vergibt keine Gruppe — Eigentümerschaft bleibt persönlich.
- **Rollen**: die eigene Rolle lässt sich nicht ändern, OWNER vergibt nur
  ein OWNER, der letzte OWNER bleibt bestehen.
- **Registrierung** ausschliesslich mit gültigem Einladungstoken; die
  blosse Kenntnis einer eingeladenen Adresse genügt nicht.
- **Uploads** gehören einem Space und werden nur an dessen Mitglieder
  ausgeliefert.
- **Sitzungen** sind einzeln widerrufbar; der Entzug wirkt auch auf
  offene Editor-Verbindungen, nicht erst beim nächsten Neuladen.
- **Rate-Limits** pro Konto und pro IP. Die IP stammt aus
  `X-Forwarded-For`, ausgewertet gemäss `TRUSTED_PROXY_HOPS` — hinter dem
  mitgelieferten Caddy setzt der Proxy den Header selbst.
- **Single Sign-on** mit PKCE, `state` und `nonce`; das ID-Token wird
  gegen die JWKS des Anbieters, den Aussteller und den Empfänger
  geprüft. Verknüpft wird über den Subject-Claim; eine E-Mail-Adresse
  übernimmt ein bestehendes Konto nur, wenn der Anbieter sie als
  bestätigt meldet, und nie bei einem Konto mit Verwaltungsrechten
  (`OIDC_AUTO_LINK_BY_EMAIL=false` schaltet die Verknüpfung ganz ab).
  Neue Konten entstehen nur mit `OIDC_ALLOW_SIGNUP=true` — sonst bleibt
  es bei Einladungen. Der zweite Faktor gilt auch bei SSO.
- **Token-Trennung**: Sitzung, Collab-Ticket, Zwei-Faktor-Zwischenschritt
  und SSO-Fluss tragen dieselbe Signatur, aber je eine eigene Audience,
  die beim Prüfen verlangt wird. Ein abgegriffenes Collab-Ticket ist
  damit keine Sitzung.
- **Zwei-Faktor-Anmeldung** nach RFC 6238, pro Konto zuschaltbar. Das
  Geheimnis liegt mit AES-256-GCM verschlüsselt in der Datenbank (Schlüssel
  aus `APP_SECRET`), Wiederherstellungscodes nur als SHA-256-Hash und jeder
  genau einmal gültig. Zwischen Passwort und Code steht ein eigenes,
  fünf Minuten gültiges Cookie — kein Sitzungscookie.
- **Audit-Log** für Anmeldungen, Rollenwechsel, Einladungen und Löschungen.

Bekannte Grenze: Hochgeladene Dateien hängen am Space, nicht an einer
Seite (`Upload.spaceId`). Ein Bild oder Anhang aus einer geschützten
Seite bleibt deshalb für jedes Space-Mitglied abrufbar, das die exakte
URL kennt — die Dateinamen sind zufällig, aber sie stehen in Exporten
und in Proxy-Logs. Wer das ausschliessen muss, sollte geschützte Seiten
vorerst ohne Anhänge führen.

## Projektstruktur

```
apps/web      Next.js (UI, Auth, API, Editor)
apps/collab   Hocuspocus WebSocket-Server (Yjs-Persistenz)
packages/db   Prisma-Schema + Client + geteilte Zugriffsregeln
packages/editor  Geteilte TipTap-Extensions
packages/mailer  Geteilter E-Mail-Versand (Web + Collab)
e2e/          Playwright-E2E-Tests
```
