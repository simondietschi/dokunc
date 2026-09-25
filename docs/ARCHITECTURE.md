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
| DB             | PostgreSQL 18 mit `pg_trgm`       | Relationale Daten + nativer Volltext (`tsvector`), Trigramm-Index für Titel |
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
│  ├─ db/       Prisma-Schema + generierter Client + Zugriffsregeln (geteilt)
│  ├─ editor/   TipTap-Schema und Collab-Protokoll (Web + Collab)
│  └─ mail/     E-Mail-Versand und Benachrichtigungsplanung (Web + Collab)
├─ e2e/         Playwright-E2E-Tests
├─ scripts/     backup.sh, docker-entrypoint.sh
├─ docs/ARCHITECTURE.md
├─ Caddyfile            Proxy: TLS (CADDY_TLS), /collab an Hocuspocus
├─ Dockerfile           Image der App (Web + Collab, Debian trixie)
├─ docker-compose.yml   Proxy, App, Postgres, Redis, Gotenberg (Prod/Dev)
├─ docker-compose.domain.yml  Zusatz eigene Domain: Port 80 (per COMPOSE_FILE)
├─ docker-compose.ipv6.yml    Zusatz IPv6: 443/80 auf APP_BIND6 (per COMPOSE_FILE)
└─ .env.example
```

## 4. Datenmodell

- **User** — id, email, name, passwordHash, createdAt; optional
  `totpSecret` (AES-256-GCM-versiegelt) und `totpEnabledAt`; optional
  `oidcSubject`/`oidcIssuer` für die Verknüpfung mit einem SSO-Anbieter.
- **TotpRecoveryCode** — userId, SHA-256-Hash, usedAt, pendingUntil
  (gesetzt: ausgegeben, aber noch nicht bestätigt; NULL: aktiv); ein Code
  pro Notfall.
- **Space** — id, name, slug, description.
- **SpaceMember** — userId, spaceId, role (`OWNER|ADMIN|MEMBER|VIEWER`).
- **Group / GroupMember / SpaceGroup** — benannte Personengruppe,
  instanzweit verwaltet, pro Space mit eigener Rolle (ohne OWNER).
- **PageGrant** — Zugriffseintrag einer geschützten Seite: entweder eine
  Person oder eine Gruppe.
- **Page** — id, spaceId, parentId (Baum), title, content (TipTap-JSON),
  textContent (für Suche/History), `searchVector` (tsvector, von Triggern
  gepflegt aus Titel (Gewicht A) und den ersten 250 000 Zeichen von
  textContent, deutsch gestemmt und unverändert; bei übergrossen Seiten
  verkürzt), position, timestamps.
- **PageVersion** — Snapshot (title, content, textContent) + Autor + Zeit.
- **CollabDocument** — pageId, Yjs-State (bytea) — von Hocuspocus verwaltet.
- **Attachment** — spaceId, pageId?, uploaderId?, storedName (zufälliger
  Name auf der Platte, unique), name (Originalname), mimeType, size.
  Bindet jede hochgeladene Datei an einen Space; `/api/files/<storedName>`
  liefert sie nur an angemeldete Mitglieder dieses Space aus. Uploads aus
  früheren Versionen ohne Datensatz werden beim ersten Abruf über die
  referenzierende Seite zugeordnet und nachgetragen. Dateien ohne
  Datensatz, die nirgends mehr verwendet werden, räumt der Web-Prozess
  periodisch weg (`lib/upload-sweeper.ts`, gestartet aus
  `instrumentation.ts`, siehe README „Verwaiste Uploads“).
- **PageChunk**: pageId, chunkIndex, text, embedding (Float32-Bytes),
  embeddingModel (Modell, mit dem das Embedding entstand; null ohne
  Embedding und beim Altbestand von vor der Migration `20260925100000`).
- **AiIndexQueue**: Seiten, deren Chunks nicht zum Text passen (pageId,
  queuedAt). Nur Trigger fügen ein, nur `indexPageChunks` entfernt.

**Trigger in der Datenbank:** `Page_aiIndexQueue_insert` und
`Page_aiIndexQueue_update` (Funktion `dokunc_ai_index_enqueue`, beide
AFTER) stellen jede neue Seite und jede echte Änderung von `textContent`
in die `AiIndexQueue`, gleich auf welchem Weg der Text entstand (Editor,
Import, Vorlage, Kopie, Wiederherstellen, rohes SQL). `Page` selbst wird
dabei nicht beschrieben. `Page_searchVector_insert` und
`Page_searchVector_update` (Funktion `dokunc_page_search_vector_set`,
beide BEFORE) setzen den Suchvektor bei jeder neuen Seite und bei jeder
echten Änderung von Titel oder `textContent`. Prisma kennt Trigger nicht:
sie stehen nur in den Migrationen `20260925100000_ai_index` und
`20260925110000_search_german_trgm`, `prisma migrate dev` lässt sie
stehen, und `prisma migrate diff` zeigt sie nicht. `pg_restore` legt
Trigger erst nach den Daten an; Warteschlange, Suchvektoren und Chunks
kommen dort aus demselben Snapshot.

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

Hochgeladene Dateien fallen unter dieselbe Regel
(`findReadableAttachment` in `lib/file-access.ts`): trägt ein Anhang einen
Seitenbezug (`Attachment.pageId`), liefert `/api/files` ihn nur aus, wenn
die Person diese Seite sehen darf. Ohne Seitenbezug (ältere Uploads,
endgültig gelöschte Seiten) ersetzt der Inhalt den Bezug: lesbar nur,
wenn mindestens eine Seite des Space die Datei verwendet (Inhalt,
Titelbild oder Version) und die Person jede davon sieht. Der Export
lädt eingebettete Bilder über dieselbe Prüfung (`uploadLoaderFor`).

Die Regel selbst steht an genau einer Stelle und wird überall
hineingereicht: als Prisma-Bedingung (`visiblePageWhere`,
`visiblePagesAcrossSpaces`), als SQL-Baustein für die Suche
(`lib/page-search.ts`), die Pfade der Treffer und den Rückgriff der KI
(`visiblePageSql`), als Einzelprüfung (`canSeePage`,
auch im Collab-Server) und als Filter für Benachrichtigungen
(`filterByPageAccess`).

**Suche.** Palette (`/api/search`) und Space-Suche (`/s/[slug]/search`)
stellen dieselbe Abfrage (`searchPages` in `lib/page-search.ts`), den Plan
dazu baut `planSearch` in `lib/search-query.ts`.

- Der Inhalt liegt als gespeicherte Spalte `Page.searchVector` vor, mit
  GIN-Index. Kein Ausdrucksindex: `ts_rank` braucht den Vektor jeder
  passenden Seite, und aus einem Ausdrucksindex liest Postgres ihn nicht,
  es berechnet ihn neu (bei einem häufigen Wort oder einem kurzen Präfix
  beim Tippen für fast alle Seiten). Keine GENERATED-Spalte, weil Prisma
  den Generierungsausdruck als Default liest und Drift meldet; die
  Trigger aus der Migration `20260925110000_search_german_trgm` pflegen
  sie.
- Der Vektor trägt Titel (Gewicht A) und Text zweimal: `german` findet
  andere Wortformen (Rechnung, Rechnungen; Haus, Häuser), `simple`
  behält, was der Stemmer abschneidet oder als Stoppwort verwirft
  („Bearbeitu“ beim Tippen, „will“). Der Text zählt bis 250 000 Zeichen.
  Überschreitet der Vektor trotzdem die Grenze von 1 MB (viele
  verschiedene Wörter aus Zeichen mit 4 Byte), fällt die Funktion auf
  `simple` über 100 000 Zeichen zurück, im äussersten Fall auf den Titel.
  So scheitert weder ein Speicherlauf noch die Migration.
- Titel per `pg_trgm` (`Page_title_trgm_idx`): ab drei Zeichen als
  Teilwort (`ILIKE '%q%'`).
- Unter drei Zeichen (Kurzmodus) nur Titelanfang und Wortanfang im Titel;
  bei genau zwei Buchstaben oder Ziffern zusätzlich das exakte Wort im
  Vektor, damit Kürzel wie KI, HR oder IT auffindbar bleiben. Alles davon
  ist indexgestützt.
- Die Anfrage entsteht aus `websearch_to_tsquery` in beiden Sprachen
  („Phrase“, `or`, `-Ausschluss`; das deutsche „oder“ wird zu `or`), das
  letzte Wort zusätzlich als Präfix (`to_tsquery(... ':*')`, nur für
  Wörter aus Buchstaben und Ziffern). Ein Ausschluss gilt in beiden
  Sprachen („-Entwürfe“ schliesst auch „Entwurf“ aus) und auch für
  Titeltreffer.
- Rang: erst Titeltreffer, dann `ts_rank`, dann das Änderungsdatum, zuletzt
  die ID, damit die Seiten beim Blättern stabil bleiben. Schnipsel
  (`ts_headline`, deutsch) nur für die ausgelieferten Zeilen. Jeder
  Treffer bringt seinen Pfad (`loadAncestorPaths`, eine rekursive Abfrage
  für alle Treffer, endet an der ersten verborgenen oder gelöschten
  Elternseite) und sein Änderungsdatum mit.
- Der Rückgriff der KI ohne Voyage (`lib/retrieval.ts`) fragt die Chunks
  ebenfalls `german` ab; der Ausdruck ist zeichengleich zum Index
  `PageChunk_fulltext_german_idx`.

## 5. Realtime-Fluss

1. Client öffnet Seite → TipTap mit `Collaboration`-Extension + Yjs-Doc.
2. Vor jedem Verbindungsversuch holt der Client ein **Collab-Ticket** von
   `POST /api/collab/ticket`: ein JWT mit eigener Audience (`dokunc-collab`),
   gebunden an genau diese Seite, gültig zwei Minuten und für genau eine
   Verbindung. Die Sitzung selbst bleibt im httpOnly-Cookie und wird nie
   an den Client ausgeliefert.
3. `HocuspocusProvider` verbindet via WebSocket zu `apps/collab` und schickt
   das Ticket. Schon vor dem Handshake begrenzt `onUpgrade` die Versuche je
   Client-Adresse und die offenen Sockets je Adresse und Instanz; ein
   Socket ohne gültiges Ticket wird nach 15 Sekunden geschlossen.
   `onAuthenticate` prüft Signatur, Audience, Seitenbindung, Token-Version
   (Session-Revocation) und Schreibrecht, begrenzt Versuche und
   Verbindungen je Person und verbraucht das Ticket (SET NX in Redis).
   Vorgaben und Begründungen der Grenzen: `apps/collab/src/limits.ts`.
4. `onLoadDocument` lädt Yjs-State aus `CollabDocument` (oder seeded aus `Page.content`).
5. Edits werden als Yjs-Updates zwischen Clients gemerged (CRDT, konfliktfrei).
6. `onStoreDocument` (debounced) schreibt Yjs-State + extrahierten Text/JSON
   zurück in `Page` und erzeugt periodisch `PageVersion`-Snapshots.

**Wiederherstellen einer Version** muss an diesem Zwischenspeicher vorbei,
und zwar auf derselben Yjs-Linie. Die Web-App schreibt den Inhalt der
Version nach `Page.content` (Suche, Export) und schickt über Redis
(`dokunc:doc-reset`) Seite, Version, Person und eine Nonce. Genau eine
Collab-Instanz führt den Austausch aus: Sie belegt die Nonce per SET NX,
wobei Instanzen, die das Dokument halten, 250 ms Vorsprung haben. Sie
tauscht den Inhalt per Direktverbindung in einer Yjs-Transaktion aus
(alles löschen, Version einfügen). Hält keine Instanz das Dokument, lädt
sie es dafür aus `CollabDocument`; hält es eine andere, die nicht
reagiert, tauscht sie nicht aus. Quittiert wird über eine Redis-Liste
(`dokunc:doc-reset-ack:<nonce>`), und zwar erst, wenn ein Speicherlauf
genau des Dokuments, in dem ausgetauscht wurde, den neuen Stand nach
`CollabDocument` geschrieben hat; ein nach dem Entladen neu geladenes
Dokument derselben Seite zählt nicht. Wurde das Dokument ungespeichert
entladen, versucht der Collab-Server es erneut und spielt dabei zuerst
den Stand des entladenen ein, damit ein Editor, der den ersten Austausch
gesehen hat, ihn nicht doppelt bekommt. Jeder Versuch endet spätestens
4,5 Sekunden nach Eingang; die Web-App wartet höchstens fünf Sekunden. Weil der Austausch auf der bestehenden Linie geschieht,
bekommen offene Editoren und die Kopien in den Browsern (y-indexeddb) die
Löschungen mit. Ein aus `Page.content` neu aufgebautes Dokument wäre
dagegen eine neue Linie, und die alten Einträge aus diesen Kopien
stünden danach wieder im Dokument. Ohne Quittung verwirft die Web-App
`CollabDocument` (der nächste Start baut aus `Page.content`) und zeigt
einen Hinweis.

**KI-Index.** Welche Seiten neue Chunks brauchen, halten die Trigger in
`AiIndexQueue` fest (siehe §4). Der Speicherlauf (`onStoreDocument`)
gleicht die eben gespeicherte Seite sofort ab (`indexPageChunks` aus
`@dokunc/db`): nur wenn sie ansteht, unter der Zeilensperre
`FOR NO KEY UPDATE`, mit Diff je `chunkIndex`, sodass unveränderte
Abschnitte ihr Embedding behalten. Alles andere (Import, Vorlagen, Kopien,
Wiederherstellen) holt der Hintergrundjob `apps/collab/src/ai-indexer.ts`
nach, alle `AI_INDEX_INTERVAL_S` Sekunden unter einer Redis-Sperre
(`dokunc:ai-index:lock`; ist Redis nicht erreichbar, läuft er ohne
Sperre, doppelte Läufe sind durch `SKIP LOCKED` und bedingtes Schreiben
unschädlich). Mit `VOYAGE_API_KEY` und `ANTHROPIC_API_KEY` bettet derselbe
Job Chunks ohne Embedding des aktuellen Modells in Stapeln ein und
schreibt je Chunk das Modell mit, nur solange der Text unverändert ist;
Papierkorb und Vorlagen bleiben aussen vor. Nach einem Wechsel von
`EMBEDDING_MODEL` baut er so den Bestand neu auf. Die Web-App
(`lib/retrieval.ts`) bettet nur noch die Frage ein: Sie vergleicht alle
Chunks der für die Person sichtbaren Seiten, stapelweise und ohne Deckel,
behält die besten acht und warnt ab 20 000 Chunks je Frage im Log. Gibt
es sichtbare Chunks ohne passendes Embedding, mischt sie Volltexttreffer
aus genau diesen bei. Im Anfragepfad wird nichts nachgebettet.

## 6. Roadmap / Status

- [x] Architektur & Plan
- [x] Monorepo-Scaffolding (pnpm, web, collab, db)
- [x] DB-Schema + Migrationen
- [x] Auth (Registrierung, Login, Session, Logout)
- [x] Spaces + Mitgliedschaften + Rollen/Permissions
- [x] Seitenbaum + CRUD + TipTap-Editor
- [x] Realtime-Co-Editing (Yjs/Hocuspocus) + Live-Cursor
- [x] Suche mit deutschen Wortformen, Wortanfängen und Operatoren,
      Trigramm-Index für Titel, Treffer mit Pfad und Änderungsdatum
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
- [x] Prod-Härtung: TLS-Reverse-Proxy (Caddy, Vorgabe nur localhost,
      per APP_BIND/APP_BIND6 änderbar), Security-Header/CSP/HSTS,
      Upload-Magic-Byte-Prüfung, non-root Container, fail-closed
      APP_SECRET, Backup-Skript
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
      Chunk-Index für alle Schreibwege (Queue per Trigger,
      Hintergrundjob im Collab-Prozess), Embeddings mit Modell je
      Chunk) + KI-Aktionen im Editor
      (Verbessern, Zusammenfassen, Übersetzen, Weiterschreiben) über
      Claude API (claude-opus-4-8, adaptive thinking, Prompt-Caching);
      graceful deaktiviert ohne ANTHROPIC_API_KEY
- [x] Editor-Parität: Syntax-Hervorhebung (lowlight), volle
      Tabellenbedienung, Bilder per Einfügen und Ziehen samt
      Alternativtext, Breite und Unterschrift, Dateianhänge,
      aufklappbare Abschnitte, Block-Griff, Anker,
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
      geteiltes Paket `@dokunc/mail` (Erwähnungen entstehen im
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
      (sticky Panel bei genug Platz, sonst einklappbarer Block, ab 1400 px
      Fensterbreite ohne eigene Wahl aufgeklappt; Einträge sind Links auf
      die Anker, ein Anker in der Adresse wird nach dem ersten
      Collab-Abgleich angesprungen)
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
      `IMPORT_MAX_MB`, managePages-Prüfung, Import-Plätzen (je Konto 1,
      global `IMPORT_MAX_CONCURRENT`, `lib/import/slots.ts`), Lesefrist für
      den Upload (`lib/import/upload-read.ts`), Zeitgrenze
      `IMPORT_TIMEOUT_S` und Rücknahme bei Abbruch oder Ausfall der
      Datenbank (`lib/import/rollback.ts`, `lib/import/db-errors.ts`)
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
      Wiederherstellungscodes als Hash; neue Codes gelten erst nach
      Bestätigung eines davon (Satz ausstehend, 30 Minuten Frist, Tausch
      in einer Transaktion, die zuerst die Nutzerzeile sperrt, in
      derselben Reihenfolge wie Einrichtung und Abbruch und mit
      `FOR NO KEY UPDATE`, damit das Anlegen neuer Codes in einem anderen
      Fenster nicht daran hängen bleibt; so verklemmen sich zwei Fenster
      nicht); zwischen Passwort und Code steht
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
      pgvector, sobald die Warnung der KI-Suche (ab 20 000 Abschnitten
      je Frage) regelmässig erscheint
- [ ] Offene Härtung: Größenlimit für Yjs-Dokumente

## 7. Setup

**Docker (empfohlen, ein Befehl):**

```bash
docker compose up -d --build     # https://localhost:7891 (Proxy), Migrationen automatisch
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
