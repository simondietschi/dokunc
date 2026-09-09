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
  `totpSecret` (AES-256-GCM-versiegelt) und `totpEnabledAt`; optional
  `oidcSubject`/`oidcIssuer` für die Verknüpfung mit einem SSO-Anbieter.
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
- **Attachment** — spaceId, pageId?, uploaderId?, storedName (zufälliger
  Name auf der Platte, unique), name (Originalname), mimeType, size.
  Bindet jede hochgeladene Datei an einen Space; `/api/files/<storedName>`
  liefert sie nur an angemeldete Mitglieder dieses Space aus. Uploads aus
  früheren Versionen ohne Datensatz werden beim ersten Abruf über die
  referenzierende Seite zugeordnet und nachgetragen.

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

Nicht abgedeckt: hochgeladene Dateien tragen nur einen Space-Bezug
(`Upload.spaceId`), keinen Seitenbezug. Die Auslieferung über
`/api/files` kann die Sichtbarkeit einer Seite deshalb nicht prüfen. Das
zu schliessen hiesse, `Upload.pageId` einzuführen und beim Hochladen
mitzugeben — bewusst offen gelassen und im README als Grenze benannt.

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
- [x] Navigation: Seiten verschieben/sortieren (movePageAction mit
      Zyklus-Check per rekursiver CTE, kompakte Neunummerierung der
      Geschwister; natives HTML5-Drag-and-Drop im Seitenbaum mit
      optimistischer Anzeige, Dialog "Verschieben nach…" als
      Tastatur-/A11y-Weg), Brotkrumen (Vorfahren per rekursiver CTE,
      Kürzung langer Pfade) und Inhaltsverzeichnis aus den Überschriften
      (sticky Panel bei genug Platz, sonst einklappbarer Block)
- [x] Anhänge beliebigen Typs (Attachment-Modell mit Space-Bezug):
      Upload mit Magic-Byte-Erkennung für Bilder, konservatives MIME-
      Mapping nach Endung, zufälliger Speichername, Limit MAX_UPLOAD_MB;
      Auslieferung nur für Space-Mitglieder (Bilder inline, PDF optional
      in CSP-Sandbox, Rest als Download mit nosniff, privater Cache);
      Editor-Block "attachment" (Slash-Befehl, Drag-and-drop, Einfügen),
      Anhangsliste unter der Seite, Altbestand wird nachgetragen
- [x] Favoriten & Zuletzt besucht: persönliche Favoriten (Favorite,
      Stern in der Kopfzeile, einklappbarer Sidebar-Abschnitt, Palette),
      Besuche via `after()` nach dem Rendern (PageVisit, pro Person auf
      200 Einträge begrenzt), Space-Startseite als Dashboard statt
      Redirect (Kennzahlen, Zuletzt besucht, Favoriten, Zuletzt
      geändert), /spaces mit Einstiegen über alle Spaces
- [x] Seitenvorlagen und Duplizieren: Vorlagen sind Seiten mit
      `isTemplate` (gleicher Editor/Collab, nicht im Seitenbaum, nicht als
      Wiki-Link-Ziel, Badge in Suche/Palette/Papierkorb), Verwaltung unter
      /s/[slug]/templates, Standardvorlagen als ProseMirror-JSON
      (`lib/builtin-templates.ts`), Picker in der Sidebar; Duplizieren als
      tiefe Kopie in einer Transaktion (Kommentar-Marks entfernt, Kopie
      direkt hinter dem Original, Collab seedet Yjs aus Page.content)
- [x] Mail-Benachrichtigungen: Dispatcher im Collab-Prozess (Redis-Lock,
      Sammelfenster für Sofort-Mails, täglicher Digest ab
      DIGEST_HOUR_UTC, ohne SMTP nur Markierung), reine Planungslogik
      planDispatch in packages/mail, Vorlagen mit Escaping, Einstellung
      pro Person im Konto (Sofort / Täglich / Aus)
- [x] Versionsvergleich: eigener Myers-Zeilen-Diff plus Wort-Diff auf
      Markdown-Basis (lib/diff.ts), Vergleich einer Version gegen den
      aktuellen Stand oder die vorherige Version, gerenderte Vorschau
      über das geteilte Schema, Wiederherstellen aus der Vergleichsseite
- [x] Space-Einstellungen (Name, Beschreibung, Emoji-Icon; Space verlassen
      ausser als letzter Owner; Löschen nur durch Owner mit Namens-
      Bestätigung inkl. Aufräumen der Upload-Dateien) und Import
      (Markdown-Baum, Confluence-HTML-Export, Notion-Export) als reine,
      getestete Pipeline in `apps/web/src/lib/import`: Zip entpacken mit
      Limits und Traversal-Ablehnung -> Format erkennen -> Seitenbaum aus
      Pfaden bzw. Confluence-Index/Breadcrumbs -> Markdown (marked, GFM)
      bzw. HTML (eigener Tag-Rewriter für Export-Makros) über
      `generateJSON` durch das geteilte Editor-Schema -> JSON-Nachbearbeitung
      (Mermaid, Admonitions) -> zwei Durchläufe in der DB: erst alle Seiten
      anlegen (IDs), dann Inhalte mit Wiki-Links/Backlinks und Bildern als
      Attachment speichern; Route Handler mit Origin-Check, Rate-Limit,
      `IMPORT_MAX_MB` und managePages-Prüfung
- [x] Editor-Fehlerbereinigung: TipTap 3 rendert nicht mehr pro
      Transaktion neu — Toolbar und KI-Menü lesen ihren Zustand über
      `useEditorState` (der Aktiv-Zustand war eingefroren), jede Aktion
      baut ihre Command-Chain erst beim Klick. React-NodeViews mit Inhalt
      (Callout) gleichen nach dem Mount die DOM-Selektion ab
      (`useCaretSync`), sonst tippte man hinter dem frisch eingefügten
      Block weiter. Slash-/Mention-Popup (`SuggestionPopup`) klappt bei
      Platzmangel nach oben und folgt beim Scrollen; Enter auf leerem
      letztem Absatz verlässt den Callout; Tab rückt im Codeblock ein;
      Tabellen-Werkzeuge in der Toolbar; Zellen `position: relative`
      (Auswahl-Overlay und Spaltengriff hingen sonst am Editor-Container);
      Link-Dialog normalisiert Eingaben (`lib/editor-text`), Cmd/Ctrl+Klick
      öffnet Links beim Bearbeiten; KI-Antworten werden als Text statt
      als HTML eingefügt
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
- [x] Single Sign-on über OIDC: Authorization Code mit PKCE, `state`
      und `nonce` in einem eigenen kurzlebigen Cookie
      (Audience `dokunc-oidc`, zehn Minuten, genau einmal gültig);
      ID-Token gegen JWKS, Aussteller und Empfänger geprüft; Bindung an
      den Subject-Claim, E-Mail-Verknüpfung nur bei `email_verified`;
      Kontoanlage nur mit `OIDC_ALLOW_SIGNUP`; der zweite Faktor gilt
      auch hier, damit er nicht an der Sicherheit des Anbieters hängt
- [ ] Ausbaustufen: S3, vollständige i18n, Prompt→Dialog-UI,
      pgvector ab ~10k Seiten
- [ ] Offene Härtung: Größenlimit für Yjs-Dokumente

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
