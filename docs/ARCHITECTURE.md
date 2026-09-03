# dokunc — Architektur & Plan

Eigener, von Docmost inspirierter, kollaborativer Wiki-/Doku-Klon.
**Zweck:** internes Team-Wiki. **Stack:** moderner Next.js-Fullstack. **Realtime:** von Anfang an.

## 1. Ziel & Scope

Ein selbst gehostetes Team-Wiki mit:

- **Auth & Benutzer** — Registrierung/Login, Benutzerprofil.
- **Spaces & Berechtigungen** — Bereiche pro Team/Projekt mit Rollen.
- **Rich-Text-Editor + Seitenbaum** — TipTap-Editor, verschachtelte Seiten.
- **Echtzeit-Kollaboration** — gleichzeitiges Editieren, Live-Cursor (Yjs/CRDT).
- **Suche & Page-History** — Postgres-Volltextsuche, Versionsverlauf.

Nicht im MVP (spätere Ausbaustufen): Kommentare, Diagramme, Embeds, PDF-Export,
S3-Storage, E-Mail, SSO/OAuth, Enterprise-Features.

## 2. Tech-Entscheidungen

| Bereich        | Wahl                              | Begründung |
|----------------|-----------------------------------|------------|
| Sprache        | TypeScript                        | End-to-end Typsicherheit |
| Runtime        | Node.js 26                        | Neueste Version (`.nvmrc`, `engines`, Docker-Image) |
| Framework      | Next.js 16 (App Router), React 19 | Ein Framework für Front- & Backend (Server Actions, Route Handler) |
| DB             | PostgreSQL 16                     | Relationale Daten + nativer Volltext (`tsvector`) |
| ORM            | Prisma 7 (+ `@prisma/adapter-pg`) | Typsichere Queries, Migrationen; v7 nutzt Driver-Adapter + `prisma.config.ts` |
| Auth           | Eigene JWT-Session (jose + bcrypt, httpOnly-Cookie) | Schlank, keine Beta-Abhängigkeit, lehrreich |
| Editor         | TipTap 3 (+ StarterKit)           | ProseMirror-basiert, identisch zu Docmost |
| Realtime       | Yjs (CRDT) + Hocuspocus-Server    | Industriestandard für Co-Editing; Docmost nutzt dasselbe |
| Realtime-Persist | Hocuspocus `onStoreDocument` → Postgres | Yjs-Update-Blob + extrahierter Text |
| Cache/Presence | Redis                             | Hocuspocus-Skalierung, später BullMQ |
| Styling        | Tailwind CSS 4 (CSS-first)        | Schnell, kein UI-Lock-in |
| Monorepo       | pnpm workspaces                   | Geteiltes `packages/db` zwischen Web & Collab |

**Warum separater Collab-Server?** Next.js (serverless-orientiert) eignet sich
schlecht für langlebige WebSocket-Verbindungen. Hocuspocus läuft als eigener
Node-Prozess (`apps/collab`) und teilt das Prisma-Schema über `packages/db`.

## 3. Repo-Struktur (Monorepo)

```
/
├─ apps/
│  ├─ web/      Next.js App (UI, API, Auth, Editor)
│  └─ collab/   Hocuspocus WebSocket-Server (Yjs-Persistenz)
├─ packages/
│  └─ db/       Prisma-Schema + generierter Client (geteilt)
├─ docs/ARCHITECTURE.md
├─ docker-compose.yml   Postgres + Redis (Prod/Dev)
└─ .env.example
```

## 4. Datenmodell

- **User** — id, email, name, passwordHash, createdAt.
- **Space** — id, name, slug, description.
- **SpaceMember** — userId, spaceId, role (`OWNER|ADMIN|MEMBER|VIEWER`).
- **Page** — id, spaceId, parentId (Baum), title, content (TipTap-JSON),
  textContent (für Suche/History), `searchVector` (tsvector), position, timestamps.
- **PageVersion** — Snapshot (title, content, textContent) + Autor + Zeit.
- **CollabDocument** — pageId, Yjs-State (bytea) — von Hocuspocus verwaltet.

Berechtigungsregeln (vereinfachtes CASL-Äquivalent in `lib/permissions.ts`):

| Rolle  | Lesen | Schreiben | Seiten verwalten | Space verwalten |
|--------|:----:|:---------:|:----------------:|:---------------:|
| OWNER  | ✓ | ✓ | ✓ | ✓ |
| ADMIN  | ✓ | ✓ | ✓ | ✓ |
| MEMBER | ✓ | ✓ | ✓ | – |
| VIEWER | ✓ | – | – | – |

## 5. Realtime-Fluss

1. Client öffnet Seite → TipTap mit `Collaboration`-Extension + Yjs-Doc.
2. `HocuspocusProvider` verbindet via WebSocket zu `apps/collab` (`/?token=…`).
3. Collab-Server authentifiziert das JWT, prüft Schreibrecht (`onAuthenticate`).
4. `onLoadDocument` lädt Yjs-State aus `CollabDocument` (oder seeded aus `Page.content`).
5. Edits werden als Yjs-Updates zwischen Clients gemerged (CRDT, konfliktfrei).
6. `onStoreDocument` (debounced) schreibt Yjs-State + extrahierten Text/JSON
   zurück in `Page` und erzeugt periodisch `PageVersion`-Snapshots.

## 6. Roadmap / Status

- [x] Architektur & Plan
- [x] Monorepo-Scaffolding (pnpm, web, collab, db)
- [x] DB-Schema + Migrationen
- [x] Auth (Registrierung, Login, Session, Logout)
- [x] Spaces + Mitgliedschaften + Rollen/Permissions
- [x] Seitenbaum + CRUD + TipTap-Editor
- [x] Realtime-Co-Editing (Yjs/Hocuspocus) + Live-Cursor
- [x] Volltextsuche (Postgres `tsvector`)
- [x] Page-History (Snapshots + Wiederherstellen, Redis-gethrottelt)
- [x] Mitgliederverwaltung + tokenbasierte E-Mail-Einladungen (SHA-256-Hash,
      Konstantzeit-Vergleich, Ablauf, Einmaligkeit, E-Mail-Bindung)
- [x] Unit-Tests (Vitest) + freundliche Error-Boundaries
- [x] Rich-Editor: Slash-Menü („/"), Tabellen, Aufgabenlisten, Bilder
      (sicherer Upload), Callouts, Mermaid-Diagramme, YouTube-Embeds,
      Highlight/Link — gemeinsames Schema für Client & Collab-Server
- [x] Härtung: Invite-only-Registrierung (erste Person = Instanz-Admin),
      APP_SECRET-Zwang in Prod, Soft-Delete/Papierkorb mit Bestätigung,
      CSRF/Origin-Check, Rate-Limiting, erweiterte Tests
- [x] Prod-Härtung: TLS-Reverse-Proxy (Caddy, nur localhost exponiert),
      Security-Header/CSP/HSTS, Upload-Magic-Byte-Prüfung, non-root
      Container, fail-closed APP_SECRET, Backup-Skript
- [x] Ops/Account: Session-Revocation, Health-Endpoint, CI-Pipeline,
      strukturiertes Logging, Account (Profil/Passwort), Passwort-Reset
      per E-Mail, Admin-Panel, Papierkorb-UI, Collab-HA (Redis), Mobile-
      Sidebar, Markdown-Export, Such-Pagination, Compose-Limits
- [x] Wiki-Links [[Seite]] mit Vorschlags-Popup, Backlinks-Anzeige
      ("Wird referenziert von"), kanonische /p/[id]-Redirects
- [x] Kollaboration: textverankerte Kommentar-Threads (anlegen,
      antworten, auflösen), @-Mentions mit Vorschlags-Popup,
      Benachrichtigungen (Glocke, /notifications, Mention-Diff im
      Collab-Server, Thread-Antworten)
- [x] KI-Layer: "Frag dein Wiki" (RAG mit Quellenangaben; Retrieval
      semantisch via Voyage-Embeddings, FTS-Fallback ohne Key;
      Chunk-Indexierung im Collab-Server) + KI-Aktionen im Editor
      (Verbessern, Zusammenfassen, Übersetzen, Weiterschreiben) über
      Claude API (claude-opus-4-8, adaptive thinking, Prompt-Caching);
      graceful deaktiviert ohne ANTHROPIC_API_KEY
- [x] Diagramme: Excalidraw-Zeichnungen (Vollbild-Editor, SVG-Preview
      nur als data-URI-img — kein Inline-SVG/XSS) und draw.io via
      embed.diagrams.net (postMessage-Protokoll, CSP frame-src);
      Quelldaten nur im Yjs/JSON-Dokument, nie im Export-HTML
- [x] Export: Markdown, HTML (JSON→HTML über das geteilte Schema via
      @tiptap/html) und PDF (Gotenberg-Service im Compose; Fallback:
      Druckansicht /p/[id]/print mit window.print)
- [x] Sicherheits-Audit: Space-Scoping aller Seiten-Actions (Umbenennen,
      Elternseite, Versions-Rollback — die IDs kommen aus dem Formular),
      Client-IP für das Rate-Limiting von rechts aus X-Forwarded-For
      (TRUSTED_PROXY_HOPS), Login-Limit auch pro Konto, gedrosseltes
      Reset-Einlösen, Server-Action-Origins in Prod ohne "localhost";
      Export bettet Bilder als data:-URI ein (PDF/HTML self-contained)
- [x] Zero-Config-Deployment: `docker compose up -d` läuft ohne .env
      (APP_SECRET wird beim ersten Start erzeugt und im Volume app_data
      gehalten, Collab-Adresse zur Laufzeit aus dem Host abgeleitet,
      pnpm im Image vorinstalliert, DATABASE_URL-Platzhalter für
      `prisma generate` im Build); CI startet den Stack als Test
- [x] Seitenvorlagen und Duplizieren: Vorlagen sind Seiten mit
      `isTemplate` (gleicher Editor/Collab, nicht im Seitenbaum, nicht als
      Wiki-Link-Ziel, Badge in Suche/Palette/Papierkorb), Verwaltung unter
      /s/[slug]/templates, Standardvorlagen als ProseMirror-JSON
      (`lib/builtin-templates.ts`), Picker in der Sidebar; Duplizieren als
      tiefe Kopie in einer Transaktion (Kommentar-Marks entfernt, Kopie
      direkt hinter dem Original, Collab seedet Yjs aus Page.content)
- [ ] Ausbaustufen: S3, SSO, vollständige i18n, Prompt→Dialog-UI,
      pgvector ab ~10k Seiten
- [ ] Offene Härtung: eigenes, kurzlebiges Collab-Token statt des
      Session-JWT im Client, Zugriffsschutz für /api/files (Attachment-
      Modell mit Space-Bezug), Größenlimit für Yjs-Dokumente

## 7. Setup

**Docker (empfohlen, ein Befehl):**

```bash
docker compose up --build        # App :3000, Collab :3001, Migrationen automatisch
```

**Lokal (ohne Docker):**

```bash
nvm use                          # Node 26
pnpm install
cp .env.example .env             # Werte anpassen
pnpm db:migrate                  # Schema + Migrationen
pnpm dev                         # web (3000) + collab (3001)
```

Details: siehe `README.md`.
