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

- **User** — id, email, name, passwordHash, createdAt; optional
  `totpSecret` (AES-256-GCM-versiegelt) und `totpEnabledAt`.
- **TotpRecoveryCode** — userId, SHA-256-Hash, usedAt; ein Code pro Notfall.
- **Space** — id, name, slug, description.
- **SpaceMember** — userId, spaceId, role (`OWNER|ADMIN|MEMBER|VIEWER`).
- **Group / GroupMember / SpaceGroup** — benannte Personengruppe,
  instanzweit verwaltet, pro Space mit eigener Rolle (ohne OWNER).
- **PageGrant** — Zugriffseintrag einer geschützten Seite: entweder eine
  Person oder eine Gruppe.
- **Page** — id, spaceId, parentId (Baum), title, content (TipTap-JSON),
  textContent (für Suche/History), `searchVector` (tsvector), position, timestamps.
- **PageVersion** — Snapshot (title, content, textContent) + Autor + Zeit.
- **CollabDocument** — pageId, Yjs-State (bytea) — von Hocuspocus verwaltet.

Die **wirksame Rolle** einer Person in einem Space ist die stärkste aus
eigener Mitgliedschaft und allen Gruppen, die dem Space zugeordnet sind
(`@dokunc/db/access`, `lib/space-access.ts`). Eine Gruppe gibt also
Rechte, nimmt aber keine.

Berechtigungsregeln (vereinfachtes CASL-Äquivalent in `lib/permissions.ts`):

| Rolle  | Lesen | Schreiben | Seiten verwalten | Space verwalten |
|--------|:----:|:---------:|:----------------:|:---------------:|
| OWNER  | ✓ | ✓ | ✓ | ✓ |
| ADMIN  | ✓ | ✓ | ✓ | ✓ |
| MEMBER | ✓ | ✓ | ✓ | – |
| VIEWER | ✓ | – | – | – |

Kommentieren hängt nicht am Schreibrecht: jede Rolle darf kommentieren.
Anmerkungen an einer einzelnen Textstelle brauchen es trotzdem, weil die
Markierung im Dokument selbst liegt.

**Geschützte Seiten.** Eine Seite lässt sich schützen; der Schutz gilt für
den ganzen Unterbaum. Sichtbar ist sie dann nur für die eingetragenen
Personen und Gruppen sowie für die Space-Verwaltung (ADMIN/OWNER), die
sonst einen Teil ihres eigenen Bereichs nicht mehr verwalten könnte.

Die teure Frage wäre „gibt es über mir eine geschützte Seite". Sie ist
deshalb materialisiert: `Page.accessRootId` zeigt auf die nächste
geschützte Seite Richtung Wurzel (auf sich selbst, wenn die Seite selbst
geschützt ist) und ist null, solange nichts im Weg steht. Angelegt und
nachgeführt wird das von `refreshAccessRoots` — beim Anlegen unter einem
Elternteil, beim Umhängen und bei jeder Änderung am Schutz, jeweils als
eine rekursive SQL-Anweisung über den ganzen Ast.

Die Regel selbst steht an genau einer Stelle und wird überall
hineingereicht: als Prisma-Bedingung (`visiblePageWhere`,
`visiblePagesAcrossSpaces`), als SQL-Baustein für die beiden
Volltextabfragen (`visiblePageSql`), als Einzelprüfung (`canSeePage`,
auch im Collab-Server) und als Filter für Benachrichtigungen
(`filterByPageAccess`).

## 5. Realtime-Fluss

1. Client öffnet Seite → TipTap mit `Collaboration`-Extension + Yjs-Doc.
2. Vor jedem Verbindungsversuch holt der Client ein **Collab-Ticket** von
   `POST /api/collab/ticket`: ein JWT mit eigener Audience (`dokunc-collab`),
   gebunden an genau diese Seite, gültig zwei Minuten. Die Sitzung selbst
   bleibt im httpOnly-Cookie und wird nie an den Client ausgeliefert.
3. `HocuspocusProvider` verbindet via WebSocket zu `apps/collab` und schickt
   das Ticket. `onAuthenticate` prüft Signatur, Audience, Seitenbindung,
   Token-Version (Session-Revocation) und Schreibrecht.
4. `onLoadDocument` lädt Yjs-State aus `CollabDocument` (oder seeded aus `Page.content`).
5. Edits werden als Yjs-Updates zwischen Clients gemerged (CRDT, konfliktfrei).
6. `onStoreDocument` (debounced) schreibt Yjs-State + extrahierten Text/JSON
   zurück in `Page` und erzeugt periodisch `PageVersion`-Snapshots.

**Wiederherstellen einer Version** muss an diesem Zwischenspeicher vorbei:
Die Web-App schickt über Redis (`dokunc:collab:control`) eine Räumung, der
Collab-Server wirft das Dokument aus dem Speicher, nimmt für fünf Sekunden
keine Verbindungen an und speichert in dieser Zeit nicht. Erst danach
schreibt die Web-App den alten Stand zurück. Ohne diesen Schritt hätte die
noch offene Sitzung ihn beim nächsten Speichern lautlos überschrieben.

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
- [x] Editor-Parität: Syntax-Hervorhebung (lowlight), volle
      Tabellenbedienung, Bilder per Einfügen und Ziehen samt
      Alternativtext, Breite und Unterschrift, Dateianhänge,
      aufklappbare Abschnitte, Block-Griff, Gliederung, Anker,
      Wortzähler, Seiten-Symbol, Titelbild, Vorlagen, Markdown
      einfügen und importieren, vollständiger Export
- [x] Freigabelinks: Lesen ohne Konto über ein gehashtes Token, Dateien
      über eine eigene, an die Freigabe gebundene Route; Live-Glocke über
      Server-Sent Events und Redis; Datenauskunft als JSON und
      Kontolöschung mit Schranken (letzter Admin, verwaiste Spaces)
- [x] Seitenbaum: Verschieben per Ziehen mit Zyklusschutz
      (`isDescendantOf`, DB-gestützt getestet), Favoriten, zuletzt
      besuchte Seiten
- [x] Benachrichtigungen: E-Mail für Erwähnungen und Kommentare über ein
      geteiltes Paket `@dokunc/mailer` (Erwähnungen entstehen im
      Collab-Server, Kommentare in der Web-App), Seiten-Abonnements,
      Einstellungen pro Person
- [x] Verlauf und Verwaltung: Versionsvergleich mit Wort-Diff und
      Vorschau, Paginierung; lokaler Offline-Puffer (y-indexeddb) mit
      ehrlichem Verbindungsstatus; Space umbenennen, verlassen und
      offene Spaces zum Beitreten
- [x] Zusammenarbeit: Kommentare zur ganzen Seite, Bearbeiten eigener
      Kommentare, Benachrichtigung bei neuem Thread, Kommentarrecht für
      VIEWER; Sitzungsverwaltung mit einzeln abmeldbaren Geräten und
      wiederkehrender Rechteprüfung im Collab-Server
- [x] Sicherheitsfundament: alle Space-gebundenen Schreibzugriffe über
      geprüfte Guards (`lib/page-guards`, DB-gestützte Autorisierungstests),
      Collab-Ticket statt Sitzungs-JWT im Client, autorisierte
      Datei-Auslieferung (`Upload` mit Space-Bezug), Registrierung nur mit
      echtem Einladungstoken, Anmelde-Bremse pro Konto, X-Forwarded-For nur
      mit konfigurierter Proxy-Hop-Zahl, Rollenregeln ohne
      Selbstbeförderung (`lib/role-policy`), Audit-Log mit Admin-Ansicht,
      ESLint als CI-Gate
- [x] Diagramme: Excalidraw-Zeichnungen (Vollbild-Editor, SVG-Preview
      nur als data-URI-img — kein Inline-SVG/XSS) und draw.io via
      embed.diagrams.net (postMessage-Protokoll, CSP frame-src);
      Quelldaten nur im Yjs/JSON-Dokument, nie im Export-HTML
- [x] Export: Markdown, HTML (JSON→HTML über das geteilte Schema via
      @tiptap/html) und PDF (Gotenberg-Service im Compose; Fallback:
      Druckansicht /p/[id]/print mit window.print)
- [x] Zwei-Faktor-Anmeldung: TOTP nach RFC 6238 (selbst gerechnet, gegen
      die Testvektoren der Norm geprüft), QR-Code zur Einrichtung,
      Geheimnis nur versiegelt in der Datenbank (`lib/secret-box`,
      Schlüssel aus `APP_SECRET`), einmalig gültige
      Wiederherstellungscodes als Hash; zwischen Passwort und Code steht
      ein eigenes Cookie mit eigener Audience (`dokunc-2fa`, fünf
      Minuten) statt einer halbfertigen Sitzung
- [x] Gruppen und Seitenberechtigungen: instanzweit verwaltete Gruppen,
      pro Space mit eigener Rolle (ohne OWNER); geschützte Seiten mit
      vererbtem Schutz über `Page.accessRootId`, Freigaben an Personen
      und Gruppen; dieselbe Regel in Baum, Suche, Vorschlägen, Export,
      Druck, RAG, Benachrichtigungen, Freigabelinks und im Collab-Server
- [ ] Ausbaustufen: S3, SSO, vollständige i18n, Prompt→Dialog-UI,
      pgvector ab ~10k Seiten

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
