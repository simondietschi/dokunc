# dokunc

Selbst gehostetes, kollaboratives Team-Wiki — ein von [Docmost](https://docmost.com)
inspirierter Klon. Next.js-Fullstack mit Echtzeit-Co-Editing (Yjs/CRDT).

Architektur & Designentscheidungen: siehe [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Features

- Auth & Benutzer (Invite-only-Registrierung, erste Person = Admin)
- **Single Sign-on** über OIDC (Authorization Code mit PKCE), optional
  zuschaltbar (→ `docs/admin/sso.md`)
- Spaces mit Rollen/Berechtigungen (OWNER/ADMIN/MEMBER/VIEWER)
- **Gruppen**: Personengruppen im Admin-Bereich, pro Space mit eigener
  Rolle; es gilt immer die stärkste Rolle
- **Geschützte Seiten**: eine Seite (samt Unterseiten) nur für
  ausgewählte Personen und Gruppen sichtbar
- Verschachtelter Seitenbaum + Rich-Editor (Slash-Menü „/", Tabellen,
  Aufgabenlisten, Bilder mit Alternativtext, Breite und Bildunterschrift,
  Code-Blöcke mit Syntax-Hervorhebung, aufklappbare Abschnitte, Callouts,
  Mermaid-Diagramme, YouTube-Embeds, Excalidraw-Zeichnungen und
  draw.io-Diagramme, deren Zeichenfenster vor dem Verwerfen ungesicherter
  Änderungen nachfragen); Tab rückt im Codeblock ein, Tabellen-Werkzeuge
  (Zeile/Spalte einfügen und löschen, Kopfzeile, Tabelle löschen)
  erscheinen in der Toolbar, sobald der Cursor in einer Tabelle steht;
  Links öffnen im Lesemodus per Klick, beim Bearbeiten per Cmd/Ctrl+Klick
- Block-Griff zum Verschieben, Duplizieren und Löschen; Anker an jeder
  Überschrift, Wortzähler
- Navigation: Seiten per Drag and Drop im Seitenbaum verschieben und
  sortieren (oder per Dialog „Verschieben nach…"), Brotkrumen über dem
  Titel, Inhaltsverzeichnis aus den Überschriften der Seite (auf breiten
  Schirmen als Spalte neben dem Text, sonst aufklappbar über dem Inhalt
  und ab 1400 px Fensterbreite von sich aus offen; jeder Eintrag ist ein
  Link auf den Anker der Überschrift, und ein geteilter Link mit Anker
  springt nach dem Laden an diese Stelle)
- Seiten-Symbol und Titelbild
- Markdown einfügen und importieren
- Echtzeit-Kollaboration mit Live-Cursorn (Yjs + Hocuspocus)
- **Wiki-Links** `[[Seite]]` mit Vorschlags-Popup + **Backlinks**
- **Kommentare**: textverankerte Threads und Kommentare zur ganzen
  Seite, bearbeitbar, mit Benachrichtigung an Beteiligte; auch die
  VIEWER-Rolle darf mitreden. Dazu **@-Mentions** und die Glocke, die
  sich live aktualisiert. Optional **per Mail**, sofort gebündelt oder
  als tägliche Zusammenfassung, pro Person im Konto einstellbar. Wer einer
  Seite folgt (Glocke im Seitenkopf), erfährt von neuen Kommentaren und von
  Änderungen am Inhalt. Ein Klick auf eine Benachrichtigung, in der App oder
  in der Mail, markiert sie als gelesen und führt bei Kommentaren direkt zum
  Thread, auch wenn er erledigt ist oder man sich zuerst anmelden muss. Die übrigen ungelesenen Meldungen zu
  diesem Thread gelten damit ebenfalls als gelesen, und ihre noch
  ausstehenden Mails entfallen. Ist der Kommentar inzwischen gelöscht, sagt
  die Seite das. Mail-Links führen über die Benachrichtigung selbst: ist sie
  nach der Aufbewahrungsfrist gelöscht (`NOTIFICATION_RETENTION_DAYS`,
  Vorgabe 90 Tage nach dem Lesen) oder bist du mit einem anderen Konto
  angemeldet, landest du in der Liste der Benachrichtigungen. Eine Änderung
  meldet dokunc höchstens alle zwei Minuten je Seite und nur einmal, bis die
  Meldung oder die Seite geöffnet ist; die Meldung führt zum Vergleich mit
  dem Stand davor. Was nach dem Lesen der Meldung im selben
  Zwei-Minuten-Fenster noch geschrieben wird, meldet erst die nächste
  Bearbeitung der Seite
- **KI**: „Frag dein Wiki" (RAG mit Quellen, Claude API) über den ganzen
  Bestand, auch gleich nach einem Import, + KI-Aktionen
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
- **Volltextsuche** mit deutschen Wortformen (Rechnung findet Rechnungen),
  Wortanfängen und Operatoren („genaue Folge“, oder, -Wort ausschliessen);
  Treffer zeigen Pfad und Änderungsdatum
- **Versionsverlauf** mit Versionsvergleich
  (Zeilen- und Wort-Diff gegen den aktuellen Stand oder die vorherige
  Version, Vorschau vor dem Wiederherstellen, seitenweise durch den ganzen
  Verlauf blätterbar), Papierkorb (auf Wunsch mit Frist)
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
- **Grössengrenzen** für die gemeinsame Bearbeitung: sehr grosse Seiten
  werden nur noch lesbar, die grössten listet `/admin/documents`
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
    2000 Dateien / 200 MB entpackt pro Import (alle Zips zusammen; 32 MB
    pro Zip-Eintrag, Seitendateien bis 5 MB), 2000 Seiten pro Import,
    5 Importe pro 10 Minuten je Konto und Client-Adresse, höchstens ein
    laufender Import je Konto und insgesamt höchstens
    `IMPORT_MAX_CONCURRENT` (Default 2) gleichzeitig laufende Importe
    (mit Redis über alle Instanzen; darüber antwortet der Server mit 429).
    Ein Upload muss nach 30 Sekunden Anlauf im Schnitt mindestens
    128 KiB/s liefern, sonst wird er mit 408 abgebrochen und gibt seinen
    Platz frei. Zips werden Eintrag für Eintrag entpackt und Bilder
    nacheinander gespeichert: entpackt liegt jeweils nur die Seite in
    Arbeit und ein Bild im Speicher, nicht der ganze Import (gemessen:
    rund 40 MB Spitze bei 190 MB Bildern auf einer Seite, vorher rund
    390 MB). Der Upload selbst liegt beim Einlesen des Formulars
    kurzzeitig mehrfach im Speicher. Ein Import läuft ganz oder gar
    nicht: bricht er nach dem Anlegen ab (Fehler, Ausfall der Datenbank,
    Abbruch im Browser oder Zeitgrenze `IMPORT_TIMEOUT_S`, Default
    80 Sekunden, erlaubt 1 bis 3600; Werte ausserhalb werden gekappt,
    ungültige wie `0` oder `Infinity` ergeben den Default, beides mit
    Warnung im Log), werden alle schon angelegten Seiten, Anhänge und
    Bilddateien wieder entfernt. Fehler einzelner Dateien werden als
    Hinweise gesammelt, der Rest wird importiert; scheitert jede Seite,
    gilt der Import als gescheitert und wird ebenfalls zurückgenommen,
    und die Fehlermeldung nennt mit den Hinweisen die gescheiterten
    Dateien und den Grund (bis zu 200 Hinweise, darüber nur die Anzahl).

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
- Die erste Registrierung wird Instanz-Admin (→ `docs/admin/first-account.md`);
  danach ist die Anmeldung nur noch per Einladung möglich.
- Status: `docker compose ps` · Logs: `docker compose logs -f app`
- Stoppen: `docker compose down` (Daten bleiben). Update und Rückweg:
  siehe „Update und Rückweg“ unten.

Hinweise:

- TLS nutzt Caddys **interne CA** (`localhost`). Der Browser zeigt anfangs
  eine Zertifikatswarnung — für internen/VPN-Betrieb ok, oder die Caddy-Root-CA
  importieren.
- **Nur der Proxy ist exponiert**, gebunden an `127.0.0.1:7891` (kein LAN-Zugriff;
  Adresse und Port über `APP_BIND` und `APP_PORT` in `.env` änderbar, s. u.).
  App, Datenbank, Redis und Gotenberg haben keine Host-Ports. Der Proxy
  erreicht nur die App, nicht Datenbank und Redis; Gotenberg hängt nur mit
  der App in einem eigenen Netz ohne Ausgang (siehe „Sicherheit“).
- Der App-Container läuft als **non-root**. Alle Container laufen ohne
  zusätzliche Rechte, mit schreibgeschütztem Dateisystem und mit Grenzen
  für Speicher und Prozesse; Redis verlangt ein Passwort, das beim ersten
  Start entsteht (siehe „Sicherheit“). Daten liegen in den Volumes
  `db_data`, `redis_data`, `uploads`, `app_data`.

### Eigene Domain / Produktionsbetrieb

Eine `.env` neben der `docker-compose.yml` genügt — ein Rebuild ist dafür
nicht nötig, die Adressen werden zur Laufzeit ausgewertet:

```env
SITE_ADDRESS=wiki.example.com
APP_URL=https://wiki.example.com
CADDY_TLS=admin@example.com
APP_BIND=0.0.0.0
APP_PORT=443
COMPOSE_FILE=docker-compose.yml:docker-compose.domain.yml
POSTGRES_PASSWORD=<eigenes Passwort>
```

`APP_SECRET` gehört nicht in diese Liste: das beim ersten Start erzeugte
Secret im Volume `app_data` gilt für die Domain genauso. Ein eigenes
braucht es nur, wenn mehrere Instanzen dasselbe Secret teilen sollen.
Läuft die Instanz schon, dann den bestehenden Wert übernehmen, nie einen
neuen erzeugen (er steht in
`docker compose exec -T app cat /app/data/app_secret`): ein neuer Wert
meldet alle ab und sperrt die Zwei-Faktor-Anmeldung (siehe „Secret
wechseln“). Mit dem Secret in der `.env` diese nur für das eigene Konto
lesbar machen (`chmod 600 .env`) und getrennt von den Sicherungen
aufbewahren.

`SITE_ADDRESS` und `APP_URL` müssen denselben Namen tragen: `APP_URL`
entscheidet allein, welche Herkunft die Route-Handler (Upload, Import,
Collab-Ticket, KI) annehmen. Bleibt sie auf `localhost` stehen, während
die Instanz unter der Domain läuft, antworten diese Aufrufe mit 403 —
das Log nennt dann beide Namen.

`CADDY_TLS` bestimmt, woher das Zertifikat kommt. Die Vorgabe `internal`
nimmt Caddys eigene CA, der Browser warnt dann. Eine Mailadresse schaltet
ACME ein: Caddy holt das Zertifikat bei Let's Encrypt (fällt das aus, bei
ZeroSSL), erneuert es selbst und hinterlegt die Adresse als Kontakt beim
Konto der Zertifizierungsstelle. Ein leerer Wert zählt wie `internal`.
Die `Caddyfile` selbst bleibt unverändert, wie alle versionierten
Dateien: alles Eigene steht in der `.env`.

`APP_BIND` ist die Adresse, auf der der Proxy Verbindungen annimmt. Die
Vorgabe `127.0.0.1` lässt nur den Server selbst herein; ohne
`APP_BIND=0.0.0.0` (alle IPv4-Adressen des Servers) oder eine bestimmte
Adresse des Servers bleibt die Instanz von aussen unerreichbar, auch mit
`APP_PORT=443`. `COMPOSE_FILE` bindet `docker-compose.domain.yml` ein:
sie veröffentlicht zusätzlich Port 80 auf derselben Adresse, für den
Let's-Encrypt-Nachweis und die Umleitung von `http://` auf `https://`.
Weil die Zeile in der `.env` steht, liest jeder `docker compose`-Befehl
die Datei mit, auch `scripts/backup.sh`. Die Domain muss per DNS auf den
Server zeigen, und eine Firewall davor muss Port 80 und 443 durchlassen.

`COMPOSE_FILE` ersetzt die Standardliste von `docker compose`: eine
vorhandene `docker-compose.override.yml` wird dann nicht mehr von selbst
gelesen, und ihre Anpassungen (Limits, Volumes, Ports) fielen beim
nächsten `docker compose up -d` ohne Meldung weg. Wer eine nutzt, hängt
sie ans Ende der Liste:
`COMPOSE_FILE=docker-compose.yml:docker-compose.domain.yml:docker-compose.override.yml`.
Der Trenner ist unter Linux und macOS `:`, unter Windows `;` (änderbar
über `COMPOSE_PATH_SEPARATOR`).

**IPv6:** `APP_BIND=0.0.0.0` bedient nur IPv4. Docker veröffentlicht
einen Port mit ausdrücklicher Adresse nur in deren Adressfamilie, und
`APP_BIND` nimmt genau eine Adresse. Hat die Domain einen AAAA-Eintrag,
erreichen reine IPv6-Clients die Instanz dann nicht, und Let's Encrypt
versucht den Nachweis zuerst über IPv6. Entweder den AAAA-Eintrag
weglassen oder IPv6 mit `docker-compose.ipv6.yml` dazunehmen: sie
veröffentlicht 443 und 80 zusätzlich auf `APP_BIND6`. Dessen Vorgabe ist
`::1`, also wie bei `APP_BIND` nur der Server selbst; für alle
IPv6-Adressen in der `.env`:

```env
APP_BIND6=::
COMPOSE_FILE=docker-compose.yml:docker-compose.domain.yml:docker-compose.ipv6.yml
```

Die Datei nur einbinden, wenn der Server IPv6 hat, sonst startet der
Proxy nicht. Welche Adressen der Proxy tatsächlich belegt, zeigt
`docker compose ps proxy` in der Spalte `PORTS`.

Dann `docker compose up -d` (erstes Konto → `docs/admin/first-account.md`). Aktualisiert wird wie im Abschnitt „Update
und Rückweg“ beschrieben; weil keine versionierte Datei geändert ist,
läuft der Pull ohne Konflikt durch. Ein selbst gesetztes
`APP_SECRET` hat Vorrang vor dem automatisch erzeugten; ein anderer Wert
als bisher meldet alle ab und sperrt die Zwei-Faktor-Anmeldung (siehe
„Secret wechseln“).
Weitere Optionen — SMTP für Einladungs- und
Benachrichtigungs-Mails (`MAIL_DISPATCH_INTERVAL_S`, `DIGEST_HOUR_UTC`),
`ANTHROPIC_API_KEY` für die KI-Funktionen, `VOYAGE_API_KEY` für die
semantische Suche von „Frag dein Wiki“, `AI_INDEX_INTERVAL_S` für den
KI-Index, `MAX_UPLOAD_MB` für das
Upload-Limit, `UPLOAD_SWEEP_INTERVAL_H` für den Aufräumer verwaister
Uploads, die Fristen der Aufbewahrung (`SESSION_RETENTION_DAYS` und
weitere), `SESSION_IDLE_TIMEOUT` für die Abmeldung nach Untätigkeit
(empfohlen für geteilte Geräte) — siehe `.env.example`.

Ohne SMTP zeigt die Mitgliederseite nach dem Einladen den Einladungslink
an, einmalig und mit Knopf zum Kopieren. Er ist 7 Tage gültig und gehört
nur an die eingeladene Person: wer ihn hat, kann mit der eingeladenen
Adresse ein Konto anlegen. Ist er verloren, lädt man dieselbe Adresse
erneut ein; der alte Link wird damit ungültig. Dasselbe gilt, wenn SMTP
eingerichtet ist, der Versand aber scheitert und es für die Adresse keine
gültige Einladung gab. Den Link sehen nach Vorgabe nur Admin-Personen der
Instanz, in Spaces, die sie verwalten (`INVITE_LINK_WITHOUT_MAIL=admins`);
andere Space-Verwaltende erfahren, dass die Einladung nicht zugestellt
wurde. Gibt es für die Adresse schon eine gültige Einladung, lässt ihr
erneutes Einladen diese unverändert, auch die Rolle: ein Link, den eine
Admin-Person schon weitergegeben hat, bleibt so gültig. Mit `INVITE_LINK_WITHOUT_MAIL=managers` sehen ihn alle, die einen
Space verwalten; jeder andere Wert gilt als `admins`, mit einer Warnung im
Log. Weil jede angemeldete Person einen eigenen Space anlegen
kann, kann dann jede Person Konten für beliebige Adressen anlegen; mit SSO
in diesem Fall `OIDC_AUTO_LINK_BY_EMAIL=false` setzen, sonst landet die
spätere SSO-Anmeldung der echten Person in diesem Konto. Der Link steht
nie im Log der Produktion und nie im Audit-Log (dort steht
`delivery: "mail"`, `"link"` oder `"none"`). Einladungen, die vor diesem
Update ohne Mailserver ausgesprochen wurden, haben niemanden erreicht:
erneut aussprechen, dann erscheint der Link.

Der Link zum Zurücksetzen des Passworts steht ohne SMTP nur ausserhalb
der Produktion im Log (`SMTP fehlt — … nur im Log`), in der Produktion
nie; die Empfängeradresse steht in keinem Fall darin. Scheitert der
Versand einer Mail zum Zurücksetzen des Passworts, oder fehlt in der
Produktion SMTP, zeigt das Formular trotzdem die übliche Bestätigung —
sonst verriete es, welche Adressen ein Konto haben. Der Fehler steht als
`reset mail failed` mit Konto- und Reset-ID im Log (ohne Adresse, ohne
Link). Nur wenn keine Verbindung zum Mailserver zustande kam oder sie
abbrach (abgewiesen, Zeitüberschreitung, Socketfehler) oder der Server
mit 4xx antwortete, zählt der Versuch nicht gegen die Bremse pro Konto
(drei je Stunde). Alles andere zählt: eine dauerhafte Ablehnung (5xx),
ein abgewiesener Empfänger (auch mit 4xx), ein nicht auflösbarer
Servername, fehlendes SMTP und jeder unbekannte Fehler.

**Umstieg von einer von Hand geänderten `docker-compose.yml` oder
`Caddyfile`:** Frühere Fassungen dieser Anleitung liessen in der
`docker-compose.yml` `127.0.0.1:` entfernen und `"80:80"` ergänzen und in
der `Caddyfile` die Zeile `tls internal` löschen. Beides steht jetzt in
der `.env`, und `git pull` bricht an den geänderten Dateien ab. Wer in
den beiden Dateien noch anderes geändert hat, sichert es zuerst
(`git diff docker-compose.yml Caddyfile`); Anpassungen an Diensten gehören
danach in eine `docker-compose.override.yml` (in `COMPOSE_FILE`
aufnehmen, s. o.). Dann die eigenen Änderungen verwerfen und
aktualisieren:

```bash
git checkout -- docker-compose.yml Caddyfile
git pull
```

Danach `APP_BIND`, `APP_PORT`, `COMPOSE_FILE` und `CADDY_TLS` wie oben in
die `.env` setzen und
`docker compose pull --ignore-buildable && docker compose build --pull && docker compose up -d --wait`
(wie in „Update und Rückweg“). Ohne `APP_BIND`
fällt der Proxy auf `127.0.0.1` zurück: die Instanz ist von aussen still
nicht mehr erreichbar, und die Zertifikatserneuerung scheitert. Ohne
`COMPOSE_FILE` fehlt Port 80. Ohne `CADDY_TLS` stellt Caddy wieder ein
Zertifikat seiner internen CA aus, und jeder Browser warnt.
`docker compose port proxy 443` muss danach `0.0.0.0:443` zeigen,
`docker compose port proxy 80` `0.0.0.0:80`.

**Datenbank:** Die Migrationen legen die Erweiterung `pg_trgm` an (Suche
in Titeln). Bei einer fremd verwalteten Datenbank ohne Besitzrechte muss
sie vorher eine Administratorin oder ein Administrator anlegen:
`CREATE EXTENSION pg_trgm;` (je nach Distribution im Paket
`postgresql-contrib`). Das Update mit der neuen Suche füllt einmal den
Suchvektor aller Seiten, grob 1 s je 500 bis 1000 Seiten (gemessen:
20 000 Seiten mit 50 MB Text in 30 s). So lange ist die Seitentabelle
gesperrt, weitere Instanzen warten, und der erste Start dauert länger;
der Container kann dabei kurz als „unhealthy“ erscheinen. Sicherungen
werden grösser, weil der Suchvektor etwa so viel Platz braucht wie der
Text selbst oder etwas mehr.

**Backups:** siehe „Sicherung und Rückweg“ unten.

**Verwaiste Uploads:** Der Web-Prozess räumt alle
`UPLOAD_SWEEP_INTERVAL_H` Stunden (Default 6, erlaubt 1 bis 168, `0`
schaltet ab, andere Werte passt er mit Warnung im Log an, s.
`.env.example`; der erste Lauf folgt 10 Minuten nach dem Start) Dateien aus
dem Upload-Verzeichnis, zu denen es keinen Datensatz mehr gibt, etwa nach
einem abgebrochenen Upload oder einer unterbrochenen Space-Löschung.
Gelöscht wird nur, was im Namensformat der App vorliegt, älter als
24 Stunden ist und nirgends mehr verwendet wird: weder im Seiteninhalt
(auch im Papierkorb und in Vorlagen) noch als Titelbild, in einer
Version, im Collab-Zustand, in einem Kommentar oder in einer
Space-Beschreibung. Jeder Lauf loggt, wie viel er entfernt hat. Mehrere
Instanzen stimmen sich über eine Redis-Sperre ab, sodass je Intervall in
der Regel nur eine räumt; ohne Redis (`REDIS_URL` leer) räumt jede für
sich, was unschädlich ist. Ist Redis eingerichtet, aber nicht
erreichbar, setzt der Lauf aus. Soll ein Lauf mehr als die Hälfte der
Dateien im Namensformat der App und zugleich mehr als 20 Dateien
entfernen, oder kennt die Datenbank gar keinen Anhang, bricht er ab,
ohne etwas zu löschen, und meldet das im Log; meist passen dann
`DATABASE_URL` und `UPLOAD_DIR` nicht zusammen. Frisch zurückgespielte
Dateien gelten 24 Stunden lang als neu, Datenbank und Uploads also
innerhalb dieser Frist einspielen.

**KI-Index:** Der Collab-Prozess zerlegt alle `AI_INDEX_INTERVAL_S`
Sekunden (Vorgabe 60, erlaubt 10 bis 3600) neue und geänderte Seiten in
Abschnitte, gleich auf welchem Weg der Text entstand (Editor, Import,
Vorlage, Kopie, Wiederherstellen). Mit `VOYAGE_API_KEY` und
`ANTHROPIC_API_KEY` bettet er sie in Stapeln ein (`AI_INDEX_EMBED_BATCH`,
Vorgabe 64) und merkt sich je Abschnitt das Modell; nach einem Wechsel von
`EMBEDDING_MODEL` baut er neu auf. **Damit geht der Text aller Seiten
ausser Papierkorb und Vorlagen an Voyage AI, auch geschützte Seiten, und
Kosten entstehen für den ganzen Bestand, nicht nur beim Fragen.** Solange
Abschnitte ohne Embedding sind, mischt „Frag dein Wiki“ Volltexttreffer
bei; eine frisch importierte Seite ist bis zum nächsten Lauf noch nicht
dabei. Die Suche vergleicht alle Abschnitte, die die fragende Person sehen
darf; ab 20 000 je Frage steht eine Warnung im Log.
`AI_INDEX_INTERVAL_S=0` schaltet den Index ab: dann wird kein Seitentext
mehr eingebettet, und Seiten aus Import oder Vorlagen bekommen erst beim
Bearbeiten Abschnitte. „Frag dein Wiki“ nutzt vorhandene Embeddings des
aktuellen Modells weiter, geänderte Abschnitte kommen nur noch über den
Volltext dazu, und solange `VOYAGE_API_KEY` gesetzt ist, geht jede Frage
weiter an Voyage AI. Wer gar nichts mehr an Voyage senden will, leert
`VOYAGE_API_KEY`. Mehrere Instanzen stimmen sich per Redis-Sperre ab; ist
Redis nicht erreichbar, arbeitet jede für sich (höchstens doppelte
Anfragen an Voyage). Log mit `component: "ai-indexer"`.

Beim Update auf die Version mit dem KI-Index stehen alle Seiten einmal
an. Ein Lauf schafft rund 2000 Seiten, 10 000 Seiten sind also nach rund
fünf Minuten durch; so lange warten auch neu importierte Seiten und neue
Seiten aus Vorlagen hinter dem Bestand. Embeddings von vor diesem Update
tragen kein Modell: Der erste Lauf, der etwas einbettet, ordnet sie dem
dabei verwendeten Modell zu, sofern die Vektorlänge passt (Log
„KI-Index: vorhandene Embeddings dem Modell zugeordnet“). Deshalb
`EMBEDDING_MODEL` nicht zusammen mit diesem Update wechseln, sondern erst,
wenn
`SELECT count(*) FROM "PageChunk" WHERE embedding IS NOT NULL AND "embeddingModel" IS NULL`
0 ergibt; sonst gelten die alten Vektoren als Vektoren des neuen Modells
und werden nie neu eingebettet. Ist das schon geschehen, erzwingt
`UPDATE "PageChunk" SET embedding = NULL, "embeddingModel" = NULL` den
Neuaufbau (der ganze Bestand geht dann noch einmal an Voyage AI).

**Aufbewahrung:** Ein täglicher Job im Web-Prozess löscht, was seine Frist
hinter sich hat, und dünnt den Versionsverlauf aus. Abgelaufene oder
widerrufene Sitzungen fallen 30 Tage nach Ablauf bzw. Widerruf
(`SESSION_RETENTION_DAYS`), Passwort-Reset-Links und Einladungen 30 Tage
nach Ablauf, Einlösung oder Annahme (`TOKEN_RETENTION_DAYS`), gelesene
Benachrichtigungen 90 Tage nach dem Lesen (`NOTIFICATION_RETENTION_DAYS`,
ungelesene bleiben), Audit-Einträge nach einem Jahr
(`AUDIT_RETENTION_DAYS=365`). Seiten im Papierkorb entfernt er nur, wenn
`TRASH_RETENTION_DAYS` grösser als 0 ist (Vorgabe 0: nie automatisch); ein
später einzeln gelöschter Unterast wartet, bis auch er seine Frist erreicht
hat, und lebende Unterseiten wandern an die oberste Ebene. Jede Frist in
ganzen Tagen, `0` heisst unbegrenzt. Versionen (`VERSION_RETENTION=standard`,
`off` schaltet ab): aus den letzten 24 Stunden bleibt jede, bis 30 Tage die
letzte je Stunde, danach die letzte je Tag (UTC). Immer bleiben die erste
Version einer Seite, die Quelle jeder Wiederherstellung und der Stand
unmittelbar davor. Der erste Lauf folgt 15 Minuten nach dem Start, danach
alle 24 Stunden; gelöscht wird in Stapeln, nach einer Stunde endet der Lauf
und der Rest folgt am nächsten Tag. Mehrere Instanzen stimmen sich wie beim
Aufräumer über eine Redis-Sperre ab (ohne Redis läuft jede für sich, was
unschädlich ist). Jeder Lauf loggt seine Zahlen unter
„Aufbewahrung: Lauf beendet“. Hinweise:

1. **Der erste Lauf nach dem Update wendet alle Fristen auf den ganzen
   Bestand an: er dünnt Versionen aus, löscht Audit-Einträge älter als ein
   Jahr und alte Sitzungen. Vorher eine Sicherung ziehen. Wer den Bestand
   unverändert behalten will, setzt vorher `VERSION_RETENTION=off` und
   `AUDIT_RETENTION_DAYS=0`.**
2. Postgres gibt den frei gewordenen Platz nicht sofort ans Dateisystem
   zurück, verwendet ihn aber wieder; Sicherungen werden sofort kleiner.
3. Uploads ohne Datensatz, die nur in ausgedünnten Versionen standen,
   räumt danach der Aufräumer verwaister Uploads.
4. Die Einträge eines gelöschten Space bleiben im Audit-Log, nur ohne
   Bezug zum Space; „Space gelöscht“ nennt Name und Slug.
5. Nach dem Zurückspielen einer alten Sicherung dünnt der nächste Lauf
   deren Versionen aus. Soll der alte Verlauf vollständig bleiben, vorher
   `VERSION_RETENTION=off` setzen.

### Sicherung und Rückweg

`./scripts/backup.sh` sichert Datenbank und Uploads nach `backups/`
(`db-<Zeitstempel>.dump` und `uploads-<Zeitstempel>.tar.gz`, nur für das
eigene Konto lesbar). Der Dienst `db` muss laufen, die App darf
angehalten sein. Die Uploads werden direkt aus dem Volume gepackt, ohne
Zwischenkopie. Vor dem Ablegen prüft das Skript den Dump
(Inhaltsverzeichnis mit `_prisma_migrations`, einmal vollständig
gelesen) und das Archiv (`tar tzf`). Scheitert ein Schritt, endet es mit
einer Meldung `✗ …` und einem Exit-Code ungleich 0, und in `backups/`
entsteht nichts, auch keine halbe Datei. Fortschritt steht auf der
Standardausgabe, Fehler und Warnungen auf der Fehlerausgabe.

Nicht gesichert, und nicht nötig: `redis_data` (Bremsen und Sperren,
flüchtig), `redis_auth` (das Passwort von Redis, entsteht bei Bedarf neu)
und `caddy_data` (Zertifikate, stellt Caddy neu aus; bei sehr
häufigen Neuinstallationen derselben Domain greift die Wochengrenze von
Let's Encrypt für doppelte Zertifikate).

Das `APP_SECRET` ist nicht dabei: mit ihm sind die
Zwei-Faktor-Geheimnisse versiegelt, und eine Sicherung allein soll nicht
genügen, um sie zu lesen. Wer kein eigenes `APP_SECRET` in der `.env`
setzt, sichert das automatisch erzeugte einmal getrennt, ausserhalb des
Repositorys und nicht bei den Sicherungen:

    ./scripts/backup.sh --secret-sichern ~/dokunc-app_secret

Das Skript schreibt nur ausserhalb des Repositorys, überschreibt keine
Datei mit einem anderen Secret und legt in `backups/.app_secret-merkmal`
ein Prüfmerkmal ab (ein Hash mit eigenem Präfix, weder das Secret noch
der Schlüssel daraus). Danach meldet jede Sicherung nur noch „getrennt
gesichert“. Wer das Secret schon früher mit dem bisherigen Befehl nach
`~/dokunc-app_secret` gesichert hat, ruft den Befehl oben einmal mit
derselben Datei auf: sie bleibt, wie sie ist, und das Merkmal kommt
dazu. Ändert sich das Secret im Volume später, etwa weil `app_data` neu
angelegt wurde, warnt jede Sicherung, bis das neue getrennt gesichert
ist. Steht `APP_SECRET` in der `.env`, gehört stattdessen die `.env`
getrennt gesichert; sie enthält auch `POSTGRES_PASSWORD` und die übrigen
Zugangsdaten.

**Aufbewahrung:** Mit `BACKUP_KEEP_DAYS` (in der Umgebung des Aufrufs
oder in der `.env`, die Umgebung hat Vorrang) löscht jede erfolgreiche
Sicherung danach die Sätze in `backups/`, deren Zeitstempel älter als so
viele Tage ist. Die drei jüngsten Sätze bleiben immer, auch nach einer
langen Pause. Vorgabe `0`: nie löschen. Gelöscht wird nur, was dem
Namensmuster entspricht; ein ungültiger Wert löscht nichts und erzeugt
eine Warnung. `restore.sh` löscht bei seiner Vorsicherung nie.

**Zeitplan:** mit cron (Konto, dem das Repository gehört und das Docker
bedienen darf):

    MAILTO=admin@example.com
    17 3 * * * cd /srv/dokunc && BACKUP_KEEP_DAYS=14 ./scripts/backup.sh >/dev/null

`>/dev/null` verwirft den Fortschritt; cron mailt dann nur Fehler und
Warnungen (dafür muss auf dem Server ein Mailversand eingerichtet sein).
Liegt `docker` nicht in `/usr/bin`, in der crontab `PATH` setzen. Oder
mit einem systemd-Timer, dann stehen die Läufe im Journal:

    # /etc/systemd/system/dokunc-backup.service
    [Unit]
    Description=dokunc Sicherung
    Wants=docker.service
    After=docker.service

    [Service]
    Type=oneshot
    User=dokunc
    WorkingDirectory=/srv/dokunc
    Environment=BACKUP_KEEP_DAYS=14
    ExecStart=/srv/dokunc/scripts/backup.sh

    # /etc/systemd/system/dokunc-backup.timer
    [Unit]
    Description=dokunc Sicherung täglich

    [Timer]
    OnCalendar=*-*-* 03:17
    RandomizedDelaySec=15min
    Persistent=true

    [Install]
    WantedBy=timers.target

Einschalten mit
`sudo systemctl daemon-reload && sudo systemctl enable --now dokunc-backup.timer`.
Nächster Lauf: `systemctl list-timers dokunc-backup.timer`; Ausgabe:
`journalctl -u dokunc-backup.service`. Ein gescheiterter Lauf erscheint
in `systemctl --failed`. `User=` braucht Zugriff auf Docker (Gruppe
`docker`) und muss Besitzer des Repositorys sein.

**Kopie ausser Haus:** `backups/` liegt auf demselben Server. Nach der
Sicherung etwa `rsync -a backups/ sicherung@anderer-host:dokunc/` oder
`rclone copy backups/ ziel:dokunc` anhängen (in der cron-Zeile mit `&&`,
im Service als zweites `ExecStart=`). Beide kopieren nur dazu und
löschen am Ziel nichts. Nicht `rclone sync` und nicht `rsync --delete`
nehmen: sie übertragen jede lokale Löschung auf das Ziel, die der
Aufbewahrung ebenso wie ein leeres `backups/` (etwa auf einem neuen
Host, auf dem die crontab schon wieder läuft, bevor die Sicherungen
zurückgeholt sind). Damit wäre die Kopie ausser Haus genau dann weg, wenn
sie gebraucht wird. Das Ziel braucht deshalb eine eigene Aufbewahrung,
sonst wächst es unbegrenzt, etwa `rclone delete --min-age 60d ziel:dokunc`
oder auf dem anderen Host `find ~/dokunc -type f -mtime +60 -delete`.
Die Frist dort länger wählen als `BACKUP_KEEP_DAYS`; anders als
`backup.sh` behält sie keine Mindestzahl an Sätzen. Das Secret und die
`.env` gehören nicht an dasselbe Ziel.

Zurückgespielt wird mit `./scripts/restore.sh <Zeitstempel>`. Das Skript

1. prüft Dump und Archiv, bevor es etwas ändert,
2. sichert den aktuellen Stand mit `backup.sh`,
3. spielt den Dump in eine frische Datenbank ein und bricht ab, wenn die
   Sicherung Migrationen enthält, die der ausgecheckte Code nicht kennt,
4. hält die App an und tauscht die frische Datenbank gegen die bisherige
   (die bisherige bleibt als `dokunc_vor_<Datum>_<Zeit>` liegen),
5. ersetzt den Inhalt des Upload-Volumes,
6. setzt fehlende Migrationen nach, beendet alle Sitzungen und vergibt
   eine neue Restore-Epoche,
7. startet die App und wartet, bis sie bereit ist.

Optionen: `--ja` fragt nicht nach (für Skripte), `--ohne-vorsicherung`
lässt Schritt 2 aus, `--secret DATEI` legt ein getrennt gesichertes
`APP_SECRET` ins Volume `app_data` (neuer Host oder neu angelegtes
Volume; ohne passendes Secret kommen Personen mit Zwei-Faktor nur noch
mit Wiederherstellungscodes herein).

Nach dem Restore gilt:

- Alle müssen sich neu anmelden.
- Alles seit der Sicherung ist zurückgenommen und sollte geprüft werden:
  Sperren von Konten, Passwortwechsel, Rollen, **widerrufene
  Freigabelinks (sie gelten wieder)**, angenommene Einladungen (wieder
  offen), benutzte Wiederherstellungscodes und Reset-Links (wieder
  gültig, soweit nicht abgelaufen).
- Offene Tabs übertragen nichts mehr und bitten darum, die Seite neu zu
  laden. Kopien im Browser aus der Zeit vor dem Restore werden nicht mehr
  geladen und beim nächsten Öffnen einer Seite gelöscht. Was seit der
  Sicherung geschrieben wurde, kommt also nicht zurück, auch nicht aus
  einem Browser.
- Benachrichtigungen, die zur Zeit der Sicherung noch nicht per Mail
  verschickt waren, bekommen keine Mail mehr; in der App stehen sie weiter.
- Den vorherigen Stand holt `./scripts/restore.sh <Zeitstempel der
  Vorsicherung>` vollständig zurück. Die Datenbank `dokunc_vor_…` enthält
  dazu noch, was zwischen Vorsicherung und Anhalten geschrieben wurde,
  aber keine passenden Uploads: die ersetzt Schritt 5. Mit
  `--ohne-vorsicherung` fehlen dort alle bisherigen Uploads.

Die Abschlussmeldung nennt die Datenbanken mit früheren Ständen samt
Löschbefehl, etwa
`docker compose exec db dropdb -U dokunc dokunc_vor_20260925_143512`.

### Secret wechseln

`APP_SECRET` signiert Sitzungen, Collab-Tickets, den Zwischenschritt der
Zwei-Faktor-Anmeldung und den Ablauf der SSO-Anmeldung. Aus ihm entsteht
auch der Schlüssel, mit dem die Zwei-Faktor-Geheimnisse in der Datenbank
verschlüsselt sind. Einen Übergang, in dem altes und neues Secret
gelten, gibt es nicht. Ein neuer Wert hat deshalb sofort diese Folgen:

- Alle sind abgemeldet, begonnene Anmeldungen (auch über SSO) müssen neu
  beginnen, offene Tabs verbinden den Editor erst nach der neuen
  Anmeldung wieder.
- Wer die Zwei-Faktor-Anmeldung eingeschaltet hat, kommt mit dem Code aus
  der Authenticator-App nicht mehr hinein. Die Anmeldung meldet „Der
  zweite Faktor lässt sich zurzeit nicht prüfen“, das Log
  `totp secret unreadable`, das Audit-Log den Grund
  `totp_secret_unreadable`. Zurück geht es mit einem
  Wiederherstellungscode; danach im Konto die Zwei-Faktor-Anmeldung
  abschalten und neu einrichten. Ohne Code setzt die Administration sie
  in der Verwaltung zurück („Zwei-Faktor zurücksetzen“).
- Sicherungen von vor dem Wechsel enthalten Zwei-Faktor-Geheimnisse, die
  nur das alte Secret lesen kann. Das alte deshalb aufbewahren, solange
  es solche Sicherungen gibt. Wer eine davon zurückspielt, setzt wieder
  das alte Secret (in der `.env`, oder mit `restore.sh --secret <Datei>`,
  wenn keines in der `.env` steht) und behält es; sonst müssen die
  Betroffenen die Zwei-Faktor-Anmeldung neu einrichten.

Wie viele Konten betroffen wären:

    docker compose exec -T db psql -U dokunc -d dokunc -Atc 'SELECT count(*) FROM "User" WHERE "totpEnabledAt" IS NOT NULL'

Gewechselt wird nur, wenn das Secret in fremde Hände geraten sein kann.
Wer vom automatisch erzeugten Secret auf eines in der `.env` umsteigt,
wechselt nicht, sondern übernimmt den bestehenden Wert (siehe „Eigene
Domain“). Ablauf eines Wechsels:

1. Sichern (`./scripts/backup.sh`) und das bisherige Secret aufbewahren
   (`--secret-sichern` bzw. die bisherige `.env`).
2. In der `.env` `APP_SECRET` auf einen neuen Wert setzen
   (`openssl rand -base64 48`).
3. `docker compose up -d`: die App startet mit dem neuen Secret neu.
4. Alle mit Zwei-Faktor-Anmeldung informieren.
5. Wer das automatisch erzeugte Secret nutzte: `./scripts/backup.sh`
   meldet danach „APP_SECRET steht in der .env“; die `.env` getrennt
   sichern.

Hat die einzige Administration selbst keinen Wiederherstellungscode
mehr, bleibt als letzter Ausweg die Datenbank (ohne Eintrag im
Audit-Log). Die Adresse muss genau so geschrieben sein wie in der
Verwaltung; gibt die Abfrage keine Zeile mit einer ID aus, war es die
falsche Adresse, und es hat sich nichts geändert:

    docker compose exec -T db psql -U dokunc -d dokunc -v ON_ERROR_STOP=1 -v email=admin@example.com <<'SQL'
    BEGIN;
    DELETE FROM "TotpRecoveryCode" WHERE "userId" = (SELECT id FROM "User" WHERE email = :'email');
    UPDATE "User" SET "totpSecret" = NULL, "totpEnabledAt" = NULL, "totpLastStep" = NULL WHERE email = :'email' RETURNING id;
    COMMIT;
    SQL

Das entspricht „Zwei-Faktor zurücksetzen“ in der Verwaltung
(`resetUserTotpAction`).

### Update und Rückweg

**Das Update auf die Version mit KI-Index, Aufbewahrung und
Dokumentgrenze ändert beim ersten Start ohne weiteres Zutun vier Dinge.
Wer das bisherige Verhalten behalten will, setzt die genannte Variable
vor dem Update in die `.env`, denn die ersten Läufe folgen 15 Sekunden
bzw. 15 Minuten nach dem Start:**

- Aufbewahrung (oben, Hinweis 1): 15 Minuten nach dem Start dünnt der
  erste Lauf die Versionen aus und löscht Audit-Einträge älter als ein
  Jahr. Behalten mit `VERSION_RETENTION=off` und `AUDIT_RETENTION_DAYS=0`.
- KI-Index (oben): Sind `VOYAGE_API_KEY` und `ANTHROPIC_API_KEY` gesetzt,
  geht ab dem ersten Lauf 15 Sekunden nach dem Start der Text aller Seiten
  an Voyage AI, auch der geschützten. Abschalten mit
  `AI_INDEX_INTERVAL_S=0`.
- Dokumentgrenze (unter „Collab-Server“): Seiten über 16 MB sind danach
  nur noch lesbar. Vorher mit der Abfrage dort prüfen und nötigenfalls
  `COLLAB_MAX_DOC_MB` höher setzen.
- Datenbank (oben): Die Migrationen brauchen die Erweiterung `pg_trgm` und
  füllen einmal den Suchvektor aller Seiten, der erste Start dauert
  entsprechend länger (siehe unten zu „unhealthy“).

Migrationen laufen beim Start automatisch und nur vorwärts. Vor jedem
Update deshalb sichern und den bisherigen Stand notieren:

    ./scripts/backup.sh                 # Zeitstempel notieren
    git rev-parse --short HEAD          # bisherigen Stand notieren
    git fetch
    git diff --stat HEAD origin/main -- packages/db/prisma/migrations
    docker compose images               # IDs für den Rückweg notieren
    git pull && docker compose pull --ignore-buildable \
      && docker compose build --pull && docker compose up -d --wait

Die vierte Zeile zeigt, welche Migrationen das Update mitbringt.
Mit `BACKUP_KEEP_DAYS` löscht ein späterer Lauf auch diese Sicherung,
sobald sie die Frist erreicht und nicht mehr zu den drei jüngsten
gehört; wer sich den Rückweg länger offenhalten will, kopiert den Satz
aus `backups/` an einen anderen Ort.

`docker compose pull --ignore-buildable` holt neue Fassungen von Proxy,
Datenbank, Redis und Gotenberg, jeweils innerhalb ihres Tags
(`caddy:2`, `postgres:18-trixie`, `redis:8`, `gotenberg/gotenberg:8`).
`docker compose build --pull` baut die App auf dem neusten
Node-Basis-Image. Ohne diese zwei Befehle bleiben die
Sicherheitskorrekturen aus: `--pull always` bei `up` holt zwar die
Images der Dienste, das Node-Basis-Image der App aber nicht. Die Befehle
lohnen sich auch ohne neuen Stand im Repository, etwa monatlich und mit
Sicherung vorher:
`docker compose pull --ignore-buildable && docker compose build --pull && docker compose up -d --wait`.
Ohne Zugang zu Docker Hub scheitert die Kette, und nichts wird neu
gestartet; den neuen Code allein bringt dann
`git pull && docker compose up -d --build --wait`. Nach dem Update
liegt die vorige Fassung jedes neu geholten Images nur noch als
unbenanntes Image vor, und `docker image prune` entfernt genau diese.
Deshalb erst aufräumen, wenn sich der neue Stand bewährt hat: bis dahin
ist die vorige Fassung der Rückweg (siehe Ende dieses Abschnitts).

Das Postgres-Image ist auf das Debian-Release festgelegt (`18-trixie`).
Ein neues Release bringt eine neue C-Bibliothek, die Text anders
sortieren kann; Indizes auf Text wären danach inkonsistent. Den Wechsel
auf `18-<neues Release>` deshalb wie eine Hauptversion behandeln:
sichern (`./scripts/backup.sh`), das Image in `docker-compose.yml`
ändern und zuerst nur die Datenbank starten, damit die App nicht auf
den alten Indizes schreibt:

    docker compose up -d --wait db
    docker compose exec db reindexdb -U dokunc dokunc
    docker compose exec db psql -U dokunc -d dokunc \
      -c 'ALTER DATABASE dokunc REFRESH COLLATION VERSION' \
      -c 'ALTER DATABASE postgres REFRESH COLLATION VERSION' \
      -c 'ALTER DATABASE template1 REFRESH COLLATION VERSION'
    docker compose up -d --wait

Postgres vermerkt die Version der Kollation je Datenbank und warnt bei
jeder Verbindung, solange sie nicht zur neuen C-Bibliothek passt;
`reindexdb` allein setzt sie nicht nach, erst die drei `ALTER DATABASE`.
Daran erinnert kein Werkzeug: Dependabot schlägt nur Tags mit demselben
Suffix vor, also nie den Wechsel von `-trixie` auf ein neues Release.

Bei grossem Bestand (grob ab 100 000 Seiten) laufen die Migrationen
länger als die gut drei Minuten, die der Healthcheck der App beim Start
abwartet. Dann bricht die letzte Zeile mit „container … is unhealthy“ ab,
und der Proxy bleibt aus, obwohl die Migrationen noch laufen. Das ist
kein Grund für den Rückweg: in `docker compose logs -f app` abwarten, bis
die Migrationen durch sind und die App startet, dann
`docker compose up -d --wait` erneut ausführen. Ein höheres
`--wait-timeout` hilft hier nicht, der Abbruch kommt beim ersten
„unhealthy“.

**Update auf die gehärteten Container** (Netz `edge`, Redis mit
Passwort, Rechte und Grenzen je Dienst): läuft mit dem Befehl oben ohne
Zutun. Beim ersten Start erzeugt Redis sein Passwort, `docker compose up`
legt das Netz `edge` an und startet alle Dienste neu; der Proxy antwortet
dabei kurz mit 502. Die App muss dafür neu gebaut sein, denn erst ihr
neuer Einstieg setzt das Passwort: ein `docker compose up -d` ohne Build
startet die bisherige App ohne Passwort, sie bleibt dann `unhealthy`
(„REDIS_URL der App ohne Redis-Passwort“ im Healthcheck), und der Proxy
startet nicht. `init: true` oder tini vor dem Einstieg der App in einer
override-Datei stören dabei nicht. Anpassen muss nur, wer eines der
folgenden nutzt:

- einen eigenen Dienst in der `docker-compose.override.yml`, den der
  Proxy erreichen soll: er bekommt `networks: [default, edge]`;
- einen eigenen Dienst, ein Skript auf dem Host oder ein Werkzeug über
  einen eigenen Port an `redis`, das Redis direkt anspricht: es braucht
  das Passwort. Im Container `REDISCLI_AUTH="$(cat /run/redis-auth/password)"`
  (eigene Dienste binden dazu `redis_auth:/run/redis-auth:ro` ein), auf
  dem Host `docker compose exec -T redis cat /run/redis-auth/password`;
- ein Redis mit eigenem Passwort: steht es als `--requirepass` im
  `command`, gilt es weiter und landet selbst in der Passwortdatei (die
  eigene `REDIS_URL` der App bleibt). Fällt `--requirepass` später weg,
  gilt das Passwort aus der Datei weiter; hat es andere Zeichen als
  Buchstaben, Ziffern und `. _ ~ -`, erzeugt Redis beim Start ein neues,
  und die eigene `REDIS_URL` muss dann ebenfalls weg. Steht es als
  `requirepass` in einer eigenen Konfigurationsdatei, gilt nach dem
  Update das erzeugte Passwort: die App meldet `WRONGPASS`, oder Redis
  bleibt `unhealthy`, wenn ein eigener Healthcheck das eigene Passwort
  nutzt. Dann entweder vor dem Update `requirepass` und die eigene
  `REDIS_URL` aus der override-Datei entfernen oder das eigene Passwort
  als Passwortdatei hinterlegen (nur Buchstaben, Ziffern und `. _ ~ -`).
  Das Volume dafür bringt erst die neue `docker-compose.yml` mit, also
  die Befehlskette oben aufteilen: zuerst `git pull`, dann
  `docker compose run --rm --no-deps --entrypoint sh redis -c 'printf %s "<Passwort>" > /run/redis-auth/password'`,
  dann den Rest ab `docker compose pull --ignore-buildable`. Wer die
  Datei erst nach dem Update hinterlegt, startet Redis danach neu:
  `docker compose up -d --force-recreate redis`;
- `user:` für `redis` in der override-Datei: vor dem Update entfernen.
  Der Start mit Passwort legt die Passwortdatei als root an, der
  Einstieg des Images wechselt danach selbst zum Nutzer `redis`. Mit
  `user:` bricht Redis ab („… ist nicht beschreibbar“ im Log), und die
  App startet nicht;
- Grenzen in der override-Datei über `deploy.resources.limits` für
  `proxy`, `db`, `redis` oder `gotenberg`: vor dem Update auf `mem_limit`,
  `pids_limit` und `cpus` umstellen. `docker-compose.yml` setzt dort nun
  `mem_limit` und `pids_limit`, und Compose lehnt beide Schreibweisen
  nebeneinander ab („can't set distinct values on 'mem_limit' and
  'deploy.resources.limits.memory'“): danach scheitert jeder Befehl mit
  `docker compose`, auch `scripts/backup.sh`;
- einen eigenen `entrypoint` für `redis`: er ersetzt den Start mit
  Passwort, Redis läuft dann ohne (die App schickt ihr Passwort trotzdem,
  Redis nimmt die Anmeldung ohne Meldung an).

Ein eigenes `command` für `redis` bleibt wirksam, das Passwort gilt
trotzdem; es ersetzt aber `--maxmemory 384mb` aus `docker-compose.yml`,
den Wert deshalb übernehmen. Zurück auf einen Stand vor der Härtung geht
es ohne Zutun (Rückweg unten): Redis läuft dort wieder ohne Passwort, das
Volume `redis_auth` bleibt ungenutzt liegen.

Startet die neue Version nicht (der Container startet immer wieder neu,
`docker compose logs app` nennt die gescheiterte Migration) oder zeigt sie
einen Fehler, geht es zurück auf den notierten Stand:

    git checkout <bisheriger Stand>
    test -x scripts/restore.sh || { git show main:scripts/restore.sh > scripts/restore.sh && chmod +x scripts/restore.sh; }
    docker compose build app
    ./scripts/restore.sh <Zeitstempel>

Erst der alte Code, dann die Sicherung: `restore.sh` setzt die Migrationen
des ausgecheckten Stands nach, und nur die Sicherung von vor dem Update
passt zu ihm. Die zweite Zeile holt das Skript, falls der alte Stand es
noch nicht kennt (erstes Update über diese Version). Später wieder
aktualisieren mit `git checkout main` und den Schritten oben. Hat die
zweite Zeile das Skript geholt (`git status` zeigt
`?? scripts/restore.sh`), vorher `rm scripts/restore.sh`, sonst bricht
`git checkout main` ab, weil es die unversionierte Datei überschreiben
müsste. Macht ein neu geholtes Image eines Dienstes Probleme, lässt sich
die vorige Fassung über die vor dem Update notierte ID (Zeile
`docker compose images` im Block oben) wieder einsetzen, solange sie
nicht mit `docker image prune` entfernt ist:
`docker tag <ID> <Image:Tag>` und `docker compose up -d <Dienst>`. Das
gilt für Proxy, Datenbank, Redis und Gotenberg; die App gehört zu ihrem
Stand im Repository und kommt mit den Schritten oben zurück.

## Lokale Entwicklung (ohne Docker)

Voraussetzungen: Node 26 (`.nvmrc`), pnpm, lokal laufendes PostgreSQL 16
mit pg_trgm (bei manchen Distributionen im Paket postgresql-contrib) +
Redis 7 oder neuer.

```bash
nvm use                 # Node 26
pnpm install
cp .env.example .env     # Werte anpassen
pnpm db:migrate          # Schema + Migrationen
pnpm dev                 # web :3000 + collab :3001
```

`pnpm dev` mit Ctrl+C beenden. Die pnpm-Version des Projekts
(11.27.1) startet ihre Skripte in einer eigenen Sitzung: Wird
stattdessen das Terminal oder die SSH-Sitzung geschlossen, laufen
`next dev` und der Collab-Server weiter und belegen die Ports 3000 und
3001. Das nächste `pnpm dev`
scheitert dann mit „EADDRINUSE“, und `pnpm test:e2e` nutzt still die
verwaisten Server. Finden lassen sie sich mit
`lsof -i :3000 -i :3001`, beenden mit `kill <PID>`.

## Collab-Server

Der Collab-Server prüft die Tickets mit demselben `APP_SECRET` wie die
App. Ohne eigenes Secret (mindestens 32 Zeichen) startet er nur mit
`NODE_ENV=development`, wie es `pnpm dev` setzt; `pnpm start`, die
E2E-Tests und jeder andere Start brauchen ein `APP_SECRET`. Im
Docker-Container erzeugt der Einstiegspunkt es beim ersten Start.

Umgebungsvariablen des Collab-Servers (Vorgabe in Klammern):
`COLLAB_PORT` (3001), `APP_SECRET` (Pflicht ausser unter
`NODE_ENV=development`), `DATABASE_URL` (Pflicht), `REDIS_URL`
(redis://localhost:6379; Abgleich mehrerer Instanzen, Wiederherstellen,
Bremsen, Sperren), `TRUSTED_PROXY_HOPS` (0; in docker-compose 1), die
fünf Verbindungsgrenzen `COLLAB_MAX_…` (siehe nächster Absatz),
`COLLAB_MAX_DOC_MB` (16) und `COLLAB_MAX_MESSAGE_MB` (Dokumentgrenze
plus 1), siehe unten,
`MAIL_DISPATCH_INTERVAL_S` (30, mindestens 5), `DIGEST_HOUR_UTC` (6),
`SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (false), `SMTP_USERNAME`,
`SMTP_PASSWORD`, `MAIL_FROM_ADDRESS` (für Benachrichtigungs-Mails; ohne
`SMTP_HOST` gibt es Benachrichtigungen nur in der App), `APP_URL`
(http://localhost:3000; Links in Mails), `VOYAGE_API_KEY` (leer; ohne
ihn keine Embeddings), `ANTHROPIC_API_KEY` (hier nur Schalter fürs
Einbetten: ohne ihn bettet der KI-Index nichts ein), `EMBEDDING_MODEL`
(voyage-3.5-lite), `AI_INDEX_INTERVAL_S` (60, 0 = aus),
`AI_INDEX_EMBED_BATCH` (64), `LOG_LEVEL` (info), `DEBUG_DB`
(leer; gesetzt protokolliert Prisma jede Abfrage).

Der Collab-Server begrenzt offene Verbindungen (je Instanz, je
Client-Adresse und je Person) und Verbindungsversuche (je Adresse vor dem
Handshake, je Person nach der Ticketprüfung; gezählt in Redis). Die
Grenzen stehen in `COLLAB_MAX_CONNECTIONS`,
`COLLAB_MAX_CONNECTIONS_PER_IP`, `COLLAB_MAX_CONNECTIONS_PER_USER`,
`COLLAB_MAX_ATTEMPTS_PER_IP` und `COLLAB_MAX_ATTEMPTS_PER_USER`
(Vorgaben 1000, 50, 50, 300/min, 120/min; 0 schaltet eine Grenze ab).
Hinter einem Firmen-NAT teilen sich viele Menschen eine Adresse; dort
`COLLAB_MAX_CONNECTIONS_PER_IP` und `COLLAB_MAX_ATTEMPTS_PER_IP`
anheben. Die Adresse liest der Collab-Server wie die App nach
`TRUSTED_PROXY_HOPS`. Ein Socket, der sich nicht binnen 15 Sekunden mit
gültigem Ticket anmeldet, wird geschlossen. Abweisungen stehen mit Grund
im Log (`Collab-Verbindung abgewiesen`,
`Collab-Verbindung vor dem Handshake abgewiesen`,
`Collab-Server voll, Verbindung abgewiesen`). Ein Collab-Ticket gilt zwei
Minuten und für genau eine Verbindung; der Editor holt vor jedem
Verbindungsaufbau ein neues. Wer an einer der Grenzen je Person
abprallt, sieht im Editor „Zu viele Verbindungen“ (mit dem Hinweis,
andere Tabs zu schliessen) statt „Kein Zugriff“; an den Grenzen vor dem
Handshake (je Adresse, je Instanz) bleibt es bei „Verbinde…“. In beiden
Fällen versucht der Editor es von selbst erneut.

**Grössengrenzen:** Der Collab-Server begrenzt die Grösse einer
WebSocket-Nachricht und die Grösse des Bearbeitungsstands (Yjs) einer
Seite, beide in MB (1 MB = 1024 × 1024 Bytes). Leer heisst Vorgabe,
0 schaltet eine Grenze ab, ein ungültiger Wert gilt als leer und steht
beim Start im Log. Alle Instanzen brauchen dieselben Werte.

- Nachrichtengrenze `COLLAB_MAX_MESSAGE_MB` (Vorgabe: Dokumentgrenze
  plus 1, also 17; ohne Dokumentgrenze 100 wie bisher): Eine grössere
  Nachricht schliesst der Server mit Code 1009, im Log steht
  `Collab-Nachricht ueber der Groessengrenze, Verbindung geschlossen`
  mit Seite und Person. Der Editor zeigt „Änderung zu gross“, trennt
  endgültig (kein Neuverbinden im Sekundentakt) und bietet an, die lokale
  Änderung zu verwerfen und neu zu laden. Mindestens Dokumentgrenze
  plus 1 setzen, sonst warnt der Server beim Start: fehlt ihm der Stand
  einer Seite, schickt ein Browser seine Kopie beim Abgleich in einer
  Nachricht, und eine Seite kann die Dokumentgrenze um eine Änderung
  überschreiten, bevor die Sperre greift. Dazu kommt der Rahmen des
  Protokolls. Beim Öffnen
  lädt der Editor zuerst seine Kopie aus IndexedDB (höchstens drei
  Sekunden) und verbindet erst dann; so schickt er nur, was dem Server
  fehlt, statt die ganze Kopie auf einmal.
- Dokumentgrenze `COLLAB_MAX_DOC_MB` (Vorgabe 16, für Container mit 1 GB
  eher 8): Der Server misst die Grösse beim Laden, beim Speichern und
  gedrosselt bei Änderungen. Ab der Hälfte steht ein Hinweis über der
  Seite und im Log `Collab-Dokument ueber der Warnschwelle`. Darüber
  werden alle Schreibverbindungen nur lesend, der Editor sperrt sich und
  erklärt es; im Log steht
  `Collab-Dokument ueber der Groessengrenze, nur noch lesbar`. Titel,
  Symbol und Titelbild bleiben bearbeitbar. Der Ausweg ist eine kleinere
  Version aus dem Verlauf (die Sperre fällt dann von selbst, Log
  `Collab-Dokument wieder unter der Groessengrenze, wieder beschreibbar`)
  oder eine höhere Grenze mit Neustart des Collab-Servers. Die Sperre ist
  keine harte Obergrenze: die Änderung, die sie überschreitet, wird noch
  gespeichert.
- Bestand: Seiten, die schon über der Grenze liegen, laden wie bisher,
  sind aber nur lesbar. Beim Start nennt das Log ihre Zahl
  (`Collab-Dokumente ueber der Groessengrenze`), die 20 grössten Seiten
  listet die Administration unter `/admin/documents`. Die Web-App liest
  dafür ebenfalls `COLLAB_MAX_DOC_MB`.

Für bestehende Installationen: Seiten über 16 MB sind nach diesem Update
nur noch lesbar. Startlog und `/admin/documents` gibt es erst mit dem
Update. Wer vorher wissen will, ob es solche Seiten gibt, fragt die
Datenbank:

```bash
docker compose exec db psql -U dokunc dokunc -c \
  'SELECT count(*) FROM "CollabDocument" WHERE octet_length("state") > 16 * 1024 * 1024;'
```

Ist die Zahl grösser als 0, vor dem Update `COLLAB_MAX_DOC_MB` höher
setzen. Wer erst nach dem Update prüft (Startlog, `/admin/documents`),
hebt die Grenze dann an und startet den Collab-Server neu; bis dahin
sind diese Seiten nur lesbar, verloren geht nichts.

**Änderungsmeldungen:** Wer einer Seite folgt, bekommt eine Meldung, wenn
andere ihren Inhalt ändern. Sie entsteht nur zusammen mit einem Snapshot
der Versionsgeschichte (höchstens einer je Seite alle zwei Minuten) und nur,
wenn sich der Inhalt gegenüber der letzten Version geändert hat; eine
blosse Kommentar-Markierung zählt nicht. Empfänger sind die Folgenden mit
aktivem Konto und Zugriff auf die Seite, ohne alle, die in den letzten vier
Minuten mitgeschrieben haben (gesammelt in Redis unter
`dokunc:page-editors:<Seite>`, über alle Instanzen), und ohne die im selben
Lauf neu Erwähnten. Je Person und Seite bleibt höchstens eine Meldung
ungelesen; gelesen ist sie, sobald die Meldung oder die Seite geöffnet
wird. Der Snapshot entsteht beim ersten Speichern nach Ablauf der zwei
Minuten, also am Anfang einer Bearbeitung. Was nach dem Lesen der
Meldung im selben Zwei-Minuten-Fenster noch geschrieben wird, meldet
erst die nächste Bearbeitung der Seite: endet die Bearbeitung in diesem
Fenster, entsteht für diesen Nachlauf bis dahin weder ein Snapshot noch
eine Meldung. Der Vergleich der nächsten Meldung zeigt ihn mit. Die Mail
verschickt der Dispatcher wie bei Erwähnungen, sofort gebündelt oder im
Tagesdigest. Wer hinter diese Version zurückrollt, entfernt vorher die
Zeilen mit
`DELETE FROM "Notification" WHERE type = 'PAGE_UPDATED'`: ein älterer Stand
kann sie nicht lesen.

Beim Wiederherstellen einer Version schreibt die App den Inhalt nach
`Page.content` (Suche, Export) und bittet den Collab-Server, ihn im
Yjs-Dokument der Seite auszutauschen. Er tauscht auf dem bestehenden
Yjs-Stand aus (löschen und einfügen), lädt das Dokument dafür notfalls
selbst und bestätigt erst, wenn der neue Stand gespeichert ist. Offene
Editoren übernehmen ihn sofort, und die Kopie, die jeder Browser
zusätzlich hält (IndexedDB), bekommt die Löschungen beim nächsten
Verbinden mit. Die App wartet bis zu fünf Sekunden auf diese
Bestätigung; üblich sind Sekundenbruchteile. Solange sie wartet, ist der
Knopf gesperrt und zeigt „Wird wiederhergestellt…“. Ohne Bestätigung
(kein Redis, Collab-Server nicht erreichbar, Austausch oder Speichern
gescheitert) verwirft die App den gespeicherten Yjs-Stand, damit der
nächste Start aus `Page.content` aufbaut. Die Seite zeigt dann einen
Hinweis mit den nächsten Schritten: In diesem Fall kann der alte Text
aus einem offenen Editor oder einer Browser-Kopie zurückkommen, auch
neben dem wiederhergestellten; eine zweite Wiederherstellung ohne
Hinweis räumt das in der Regel auf. Ohne laufenden Collab-Server
erscheint der Hinweis bei jeder Wiederherstellung.

## Tests

```bash
pnpm lint             # ESLint über das ganze Monorepo
pnpm typecheck        # TypeScript für Pakete und Web-App, auch Testdateien
pnpm test             # Unit-Tests von Web-App und Collab-Server (Vitest)
pnpm test:integration # Integrationstests gegen echte Datenbank und Redis
pnpm test:e2e         # Playwright-E2E: kompletter Editor-Pfad inkl.
                      # Realtime-Sync (leert die DB! Nur gegen Dev-DB laufen lassen)
```

Die Integrationstests prüfen, was in Abfragebedingungen steckt statt im
Code: dass eine Seiten- oder Versions-ID aus einem Formular niemals einen
fremden Space trifft, dass ein TOTP-Zeitschritt wie ein
Wiederherstellungscode genau einmal gilt (auch bei gleichzeitigen
Versuchen), dass neue Wiederherstellungscodes erst nach ihrer
Bestätigung gelten und den alten Satz in einem Schritt ablösen (auch
wenn zwei Fenster gleichzeitig daran arbeiten), und dass eine geschützte
Seite genau denen sichtbar ist, die sie sehen dürfen — direkt, über eine
Gruppe oder als Space-Verwaltung. Für Freigabelinks prüfen sie jede
Absage einzeln an Seite und Datei-Route (zurückgezogen, abgelaufen, Seite
gelöscht oder geschützt, Seite ausserhalb des freigegebenen Unterbaums,
fremder oder seitenloser Anhang), dass alle dieselbe Antwort geben, und
was die Unterseitenliste auslässt. Für Parameter in der Adresse prüfen
sie, dass doppelt angegebene Werte und unbrauchbare Seitenzahlen auf
Einladung, Zurücksetzen, Anmeldung und Suche dieselbe Antwort geben wie
ohne den Parameter, dass Kennungen, die jedes Objekt erbt
(`?sso=__proto__` an der Anmeldung, `?action=toString` im Audit-Log),
wie unbekannte gelten, dass die Suche NUL-Zeichen im Suchbegriff
weglässt und dass keine dieser Adressen einen Serverfehler auslöst.
Sie brauchen eine erreichbare Datenbank und ein erreichbares Redis aus
`.env` und legen ihre eigenen
Datensätze an (und wieder ab); sie leeren nichts. Einige starten dafür einen eigenen
Collab-Server (eigene Redis-Datenbank). Solange sie
laufen, darf kein anderer Collab-Server an demselben Redis hängen, etwa
aus `pnpm dev`: Pub/Sub gilt über alle Redis-Datenbanken hinweg, und er
führte die Wiederherstellungen der Tests mit aus. Der Prüf-Collab-Server
läuft mit abgeschaltetem KI-Index. Die Integrationstests nicht neben einem
laufenden `pnpm dev` starten: dessen Hintergrundjobs arbeiten auf derselben
Datenbank. Die Integrationstests der Aufbewahrung arbeiten mit einem
Zeitpunkt im Jahr 2001 und entfernen ihre eigenen Zeilen samt
Audit-Einträgen. Die Nachträge aus der Migration der Aufbewahrung gelten
für die ganze Datenbank; ihr Test führt sie darum in einer Transaktion
aus, die er am Ende zurückrollt.

Der E2E-Lauf startet Web + Collab selbst (bzw. nutzt bereits laufende
Server) und erwartet Postgres + Redis aus `.env`. In Umgebungen mit
vorinstalliertem Chromium: `PW_EXECUTABLE_PATH=/pfad/zu/chromium` setzen.
CI führt alle diese Suiten automatisch aus (`.github/workflows/ci.yml`).
Der Docker-Job spielt dabei eine Sicherung zurück, einmal auf demselben
und einmal auf einem frisch angelegten Stack, und prüft Datenbank,
Uploads, Secret, Sitzungen und Restore-Epoche, dazu, dass `backup.sh`
ein geändertes Secret bemerkt und bei passendem Secret nichts auf die
Fehlerausgabe schreibt. Er prüft ausserdem, dass Gotenberg weder
Datenbank noch Redis noch das Internet erreicht, beim Umwandeln keine
fremden Adressen lädt und einen Stoss grosser Exporte unter seiner
Speichergrenze umwandelt. Dazu, dass der Proxy weder Datenbank noch Redis
erreicht, dass Redis ein Passwort verlangt und die App es nutzt (ein
App-Image ohne Passwort meldet der Healthcheck, auch mit `init: true`),
die Härtung jedes Containers in der Konfiguration und am laufenden
Stack, und das Update von einer Installation vor der Härtung ohne
Handarbeit.

Ein eigener Job prüft die Laufzeitabhängigkeiten mit
`pnpm audit --prod --audit-level high` und das Lockfile mit Trivy. Der
Docker-Job führt die Update-Befehle aus „Update und Rückweg“ aus und
prüft das gebaute Image der App mit Trivy (hoch und kritisch, nur Lücken
mit verfügbarer Korrektur). Die CI läuft zusätzlich jeden Montag, damit
neue Meldungen auch ohne Push auffallen, und Dependabot schlägt
wöchentlich Updates vor (`.github/dependabot.yml`).

**Meldet `pnpm audit` oder Trivy eine Lücke**, der Reihe nach: das
Elternpaket aktualisieren; sonst in `pnpm-workspace.yaml` ein Override
innerhalb der Hauptversion; nur wenn es keinen Weg innerhalb der
Hauptversion gibt, die Lücke ausnehmen, mit Begründung, in
`pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`, GHSA-Kennung) und in
`.trivyignore.yaml` (Kennung aus der Trivy-Ausgabe, `purls` mit genau
der betroffenen Paketversion, `expired_at`, `statement` mit der
GHSA-Kennung). Eine Ausnahme in `ignoreGhsas` gilt für alle Versionen
eines Pakets; ob ein Override noch nötig ist, zeigt deshalb Trivy, nicht
`pnpm audit`. Nach `expired_at` meldet Trivy die Lücke wieder. Die
Schwelle wird nie gesenkt. Treffer in Postgres, Redis, Caddy oder
Gotenberg prüft die CI nicht: sie kommen mit dem nächsten
Upstream-Image und dem Update-Befehl. Meldet Trivy im Image der App eine
Lücke in einem Debian-Paket, deren Korrektur das offizielle Node-Image
noch nicht enthält, zuerst einige Tage abwarten und die CI erneut
starten; erst danach befristet ausnehmen, mit `purls` auf genau diese
Paketversion (Feld `PkgIdentifier.PURL` aus `trivy image --format json`).
Kein `apt-get upgrade` im Dockerfile. Tiptap hebt Dependabot nicht an,
auch nicht bei Sicherheitsmeldungen (Override auf genau eine Version);
es wird von Hand zusammen mit dem Override aktualisiert, Lücken darin
melden `pnpm audit` und Trivy.

## Sicherheit

Kurz, was die App bewusst tut:

- **Sitzung** im httpOnly-Cookie; der Collab-WebSocket bekommt stattdessen
  ein kurzlebiges, an eine Seite gebundenes Ticket.
- **Content-Security-Policy** mit frischer Nonce je Antwort statt
  `'unsafe-inline'`, dazu `X-Frame-Options`, `nosniff`, Referrer- und
  Permissions-Policy — in jedem Betriebsmodus, unabhängig von `NODE_ENV`.
  Nur unter `pnpm dev` (`next dev`) ist die CSP der Seiten gelockert, und
  zwar nur um das, was Fast Refresh braucht: `'unsafe-eval'` und den
  HMR-WebSocket. `/api` bleibt auch dort bei der strengen Fassung.
  Auch das Skript der Druckansicht, das den Druckdialog öffnet, trägt
  diese Nonce.
- **Export ohne Nachladen**: Exportiertes HTML und PDF bringen ihre eigene
  Content-Security-Policy mit. Sie laden nur eingebettete Bilder (`data:`)
  und Videos von YouTube wie in der App, sonst keine Adresse aus dem
  Seiteninhalt. Bilder von fremden Adressen fehlen deshalb im Export, wie
  sie schon im Editor fehlen. Der PDF-Dienst Gotenberg lädt zusätzlich nur
  seine eigene Arbeitsdatei (`--chromium-allow-list`); Warnungen „blocked
  for …“ oder „does not match any expression from the allowed list“ in
  `docker compose logs gotenberg` sind erwartet (letztere etwa für
  eingebettete Videos).
- **PDF-Dienst abgeschottet**: Gotenberg hängt nur mit der App in einem
  eigenen Netz ohne Ausgang (`render`). Sein Chromium erreicht damit weder
  Datenbank noch Redis, das LAN oder das Internet, nur die App und den
  Docker-Host selbst über die Gateway-Adresse von `render` (Dienste des
  Servers, die auf allen Adressen lauschen). Ab Docker Engine 28.0 schliesst
  auch diesen Weg eine `docker-compose.override.yml` mit

  ```yaml
  networks:
    render:
      driver_opts:
        com.docker.network.bridge.gateway_mode_ipv4: isolated
  ```

  (`docker compose up -d` legt das Netz dann neu an und startet App und
  Gotenberg neu). Ältere Engines kennen den Wert nicht (27.x bricht mit
  „unknown gateway mode isolated“ ab), darum steht er nicht in
  `docker-compose.yml`. Eigene Dienste in einer
  `docker-compose.override.yml` bleiben ohne Angabe im Standardnetz wie
  bisher; wer einen davon Gotenberg nutzen lässt, gibt ihm
  `networks: [default, render]`.
- **Netze**: Der Proxy hängt nur mit der App im Netz `edge` und erreicht
  weder Datenbank noch Redis. Datenbank und Redis teilen das Standardnetz
  mit der App und mit eigenen Diensten aus einer
  `docker-compose.override.yml` ohne `networks:` (ein pgAdmin erreicht die
  Datenbank also weiter). Das Standardnetz ist nicht intern: sonst
  verlören Ports an `db`, `redis` oder eigenen Diensten still ihre
  Wirkung, und eigene Dienste kämen nicht mehr ins Internet. Ein eigener
  Dienst, den der Proxy erreichen soll, bekommt `networks: [default, edge]`.
- **Redis mit Passwort**: Beim ersten Start erzeugt der Dienst `redis` ein
  zufälliges Passwort im Volume `redis_auth`, das nur `redis` und `app`
  einbinden; die App setzt es beim Start in ihre `REDIS_URL`, und ihr
  Healthcheck schlägt fehl, wenn das nicht geschehen ist. Einzutragen ist
  nichts, auch nicht beim Update. Das Passwort steht in keiner
  Befehlszeile und nicht in `docker inspect` (Redis liest es mit
  `--include` aus einer Datei). Von Hand:
  `docker compose exec redis sh -c 'REDISCLI_AUTH="$(cat /run/redis-auth/password)" redis-cli'`.
  Ein eigener Dienst, der Redis nutzt, bindet `redis_auth` nur lesend ein
  und liest `/run/redis-auth/password`. Neues Passwort:
  `docker compose exec redis rm /run/redis-auth/password`, dann
  `docker compose up -d --force-recreate redis app`.
- **Container gehärtet**: Jeder Dienst gibt alle Linux-Fähigkeiten ab und
  bekommt nur die nötigen zurück: der Proxy `NET_BIND_SERVICE`; Datenbank
  und Redis die, mit denen ihr Einstieg als root Besitz und Rechte
  einrichtet und zum eigenen Nutzer wechselt (die Server selbst laufen
  ohne); App und Gotenberg keine. Dazu `no-new-privileges` und ein
  schreibgeschütztes Dateisystem: geschrieben wird nur in die Volumes und
  in `tmpfs` für `/tmp`, den Cache von Next.js, den Socket der
  Datenbank und das Home von Gotenberg (dort legt Chromium beim Start den
  Ordner für Absturzberichte an). Grenzen je Dienst:

  | Dienst | Speicher | Prozesse |
  |---|---|---|
  | proxy | 256 MB | 256 |
  | app | 2 GB (dazu 1.5 CPU) | 512 |
  | db | 2 GB | 256 |
  | redis | 512 MB, davon höchstens 384 MB Daten (`--maxmemory`) | 128 |
  | gotenberg | 1 GB, zwei Umwandlungen zugleich | 512 |

  Gotenberg wandelt höchstens zwei Seiten zugleich um, weitere Exporte
  warten (höchstens 30 Sekunden). Gemessen mit 1 GB und Seiten mit gut
  13 MB eingebetteten Bildern (der Export erlaubt 16 MB): 12 gleichzeitige
  Exporte laufen durch, mehr als die Bremse einem Konto in zehn Minuten
  erlaubt; ab 15 beendet der Kernel Gotenberg, und alle laufenden Exporte
  scheitern. Wer mehr
  gleichzeitige Exporte grosser Seiten erwartet, setzt die Grenze höher
  (2 GB: 20 gemessen).

  Anpassen in der `docker-compose.override.yml` mit `mem_limit` und
  `pids_limit` je Dienst, nicht mit `deploy.resources.limits`: Compose
  lehnt beide Schreibweisen nebeneinander ab. Stösst ein Dienst an die
  Speichergrenze, beendet ihn der Kernel und Docker startet ihn neu; ein
  volles Redis lehnt dagegen nur weitere Schreibvorgänge ab. Braucht ein Dienst doch ein
  beschreibbares Dateisystem, setzt die override-Datei `read_only: false`
  für ihn. Mit `docker compose exec` als root in `db` oder `redis` lässt
  sich lesen, aber nicht direkt schreiben; für Schreibendes `-u postgres`
  bzw. `-u redis` nutzen. Interaktives `psql` in `docker compose exec db`
  meldet beim Beenden, dass es den Verlauf nicht speichern kann; das ist
  erwartet.
- **Space-Bindung** aller Schreibzugriffe: IDs aus Formularen werden gegen
  den Space geprüft, in dem die Person tatsächlich Rechte hat — und gegen
  das, was sie dort sehen darf.
- **Geschützte Seiten** wirken überall gleich: Baum, Suche, Vorschläge,
  Export, Druck, KI-Antworten, Benachrichtigungen und die
  Editor-Verbindung fragen dieselbe Regel. Ein Freigabelink auf eine
  geschützte Seite entsteht gar nicht erst und ein bestehender endet,
  sobald der Schutz gesetzt wird. Die Pfadzeile eines Suchtreffers endet
  an der ersten nicht sichtbaren Elternseite.
- **Freigabelinks** öffnen genau die freigegebene Seite und, wenn beim
  Teilen gewählt, ihre Unterseiten. Ein Link endet, sobald er
  zurückgezogen wird, abläuft oder seine Seite im Papierkorb liegt.
  Unterseiten zählen nur, solange der Weg zur freigegebenen Seite nicht
  durch den Papierkorb oder einen anderen Space führt. Jede Absage ist
  dieselbe Antwort „nicht gefunden“, auch bei doppelt angegebenen
  Parametern: an der Antwort lässt sich nicht erkennen, warum ein Link
  nicht öffnet.
- **Parameter in der Adresse**: auf den Seiten der App gilt ein mehrfach
  angegebener Parameter (`?token=a&token=b`) als nicht angegeben
  (Ausnahme Freigabelinks, siehe oben). Ein Einladungslink antwortet
  darauf mit derselben Absage wie auf ein falsches Token, ob die
  Einladung offen ist oder nicht; auch die Registrierung über diesen
  Link gilt dann nicht als eingeladen.
  Schnittstellen unter `/api` lesen wie bisher den ersten Wert.
- **Gruppen** geben Rollen, nehmen aber keine: die wirksame Rolle ist
  die stärkste aus eigener Mitgliedschaft und allen Gruppen. OWNER
  vergibt keine Gruppe — Eigentümerschaft bleibt persönlich.
- **Rollen**: die eigene Rolle lässt sich nicht ändern, OWNER vergibt nur
  ein OWNER, der letzte OWNER bleibt bestehen.
- **Registrierung** ausschliesslich mit gültigem Einladungstoken; die
  blosse Kenntnis einer eingeladenen Adresse genügt nicht. Ohne
  Mailserver erscheint der Einladungslink einmalig bei der einladenden
  Person, nach Vorgabe nur bei Admin-Personen der Instanz
  (`INVITE_LINK_WITHOUT_MAIL`), nie im Log.
- **Uploads** gehören einem Space und werden nur an dessen Mitglieder
  ausgeliefert.
- **Sitzungen** sind einzeln widerrufbar; der Entzug wirkt auch auf
  offene Editor-Verbindungen, nicht erst beim nächsten Neuladen.
- **Grössengrenzen im Collab-Server**: WebSocket-Nachrichten sind auf
  `COLLAB_MAX_MESSAGE_MB` begrenzt (auch vor der Anmeldung, bisher galten
  100 MB), Seiten über `COLLAB_MAX_DOC_MB` nur noch lesbar (siehe
  „Collab-Server“, Absatz Grössengrenzen).
- **Rate-Limits** pro Konto und pro IP. Die IP stammt aus
  `X-Forwarded-For`, ausgewertet gemäss `TRUSTED_PROXY_HOPS` — hinter dem
  mitgelieferten Caddy setzt der Proxy den Header selbst.
- **Single Sign-on** mit PKCE, `state` und `nonce`; das ID-Token wird
  gegen die JWKS des Anbieters, den Aussteller und den Empfänger
  geprüft. Verknüpft wird über den Subject-Claim; eine E-Mail-Adresse
  übernimmt ein bestehendes Konto nur, wenn sie als bestätigt gilt
  (→ `docs/admin/sso.md`), und nie bei einem Konto mit Verwaltungsrechten
  (`OIDC_AUTO_LINK_BY_EMAIL=false` schaltet die Verknüpfung ganz ab).
  Neue Konten entstehen nur mit `OIDC_ALLOW_SIGNUP=true` — sonst bleibt
  es bei Einladungen. Der zweite Faktor gilt auch bei SSO.
- **Token-Trennung**: Sitzung, Collab-Ticket, Zwei-Faktor-Zwischenschritt
  und SSO-Fluss tragen dieselbe Signatur, aber je eine eigene Audience,
  die beim Prüfen verlangt wird. Ein abgegriffenes Collab-Ticket ist
  damit keine Sitzung.
- **Zwei-Faktor-Anmeldung** nach RFC 6238, pro Konto zuschaltbar. Das
  Geheimnis liegt mit AES-256-GCM verschlüsselt in der Datenbank (Schlüssel
  aus `APP_SECRET`; ein Wechsel macht es unlesbar, siehe „Secret
  wechseln“), Wiederherstellungscodes nur als SHA-256-Hash und jeder
  genau einmal gültig. Zwischen Passwort und Code steht ein eigenes,
  fünf Minuten gültiges Cookie — kein Sitzungscookie. Neue
  Wiederherstellungscodes gelten erst, wenn man einen davon zurück
  eintippt: bei der Einrichtung ist der zweite Faktor erst danach aktiv,
  beim Erneuern gelten bis dahin die bisherigen Codes weiter.
  Unbestätigte Codes verfallen nach 30 Minuten.
- **Audit-Log** für Anmeldungen, Rollenwechsel, Einladungen und
  Löschungen, mit Frist (`AUDIT_RETENTION_DAYS`, Vorgabe ein Jahr);
  Einträge eines gelöschten Space bleiben erhalten.
- **Anhänge geschützter Seiten**: Jede hochgeladene Datei hängt an
  ihrem Space und, wo bekannt, an ihrer Seite (`Attachment.pageId`).
  `/api/files` liefert sie nur aus, wenn die Person diese Seite sehen
  darf; der Export prüft dasselbe. Anhänge ohne Seitenbezug (ältere
  Uploads, Seiten endgültig gelöscht) sind nur lesbar, wenn mindestens
  eine Seite des Space sie verwendet (Inhalt, Titelbild oder eine
  erhaltene Version) und die Person jede dieser Seiten
  sehen darf; Freigabelinks liefern sie gar nicht aus.
- **Lieferkette**: `pnpm audit` und Trivy (Lockfile und Image der App) in
  jeder CI und jeden Montag, Dependabot für npm, Docker, Compose und
  Actions, der Workflow nur mit Leserechten. Der Update-Befehl holt auch
  neue Images der mitlaufenden Dienste.

## Projektstruktur

```
apps/web      Next.js (UI, Auth, API, Editor)
apps/collab   Hocuspocus WebSocket-Server (Yjs-Persistenz)
packages/db   Prisma-Schema + Client + geteilte Zugriffsregeln
packages/editor  Geteilte TipTap-Extensions
packages/mail    Geteilter E-Mail-Versand (Web + Collab)
e2e/          Playwright-E2E-Tests
```
