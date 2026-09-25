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
  Änderungen am Inhalt. Eine Änderung meldet dokunc höchstens alle zwei
  Minuten je Seite und nur einmal, bis die Meldung oder die Seite geöffnet
  ist; die Meldung führt zum Vergleich mit dem Stand davor
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
- Die erste Registrierung wird automatisch Instanz-Admin; danach ist die
  Anmeldung nur noch per Einladung möglich.
- Status: `docker compose ps` · Logs: `docker compose logs -f app`
- Stoppen: `docker compose down` (Daten bleiben). Update und Rückweg:
  siehe „Update und Rückweg“ unten.

Hinweise:

- TLS nutzt Caddys **interne CA** (`localhost`). Der Browser zeigt anfangs
  eine Zertifikatswarnung — für internen/VPN-Betrieb ok, oder die Caddy-Root-CA
  importieren.
- **Nur der Proxy ist exponiert**, gebunden an `127.0.0.1:7891` (kein LAN-Zugriff;
  Adresse und Port über `APP_BIND` und `APP_PORT` in `.env` änderbar, s. u.).
  App/DB/Redis sind nur im internen Docker-Netz erreichbar.
- Der App-Container läuft als **non-root**. Daten liegen in den Volumes
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
APP_SECRET=<openssl rand -base64 48>
POSTGRES_PASSWORD=<eigenes Passwort>
```

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

Dann `docker compose up -d`. Aktualisiert wird wie im Abschnitt „Update
und Rückweg“ beschrieben; weil keine versionierte Datei geändert ist,
läuft der Pull ohne Konflikt durch. Ein selbst gesetztes
`APP_SECRET` hat Vorrang vor dem automatisch erzeugten (Wechsel beendet
alle bestehenden Sitzungen).
Weitere Optionen — SMTP für Einladungs- und
Benachrichtigungs-Mails (`MAIL_DISPATCH_INTERVAL_S`, `DIGEST_HOUR_UTC`),
`ANTHROPIC_API_KEY` für die KI-Funktionen, `VOYAGE_API_KEY` für die
semantische Suche von „Frag dein Wiki“, `AI_INDEX_INTERVAL_S` für den
KI-Index, `MAX_UPLOAD_MB` für das
Upload-Limit, `UPLOAD_SWEEP_INTERVAL_H` für den Aufräumer verwaister
Uploads, `SESSION_IDLE_TIMEOUT` für die Abmeldung nach Untätigkeit
(empfohlen für geteilte Geräte) — siehe `.env.example`.

Ohne SMTP steht der Link aus Reset- und Einladungsmails nur ausserhalb
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
die `.env` setzen und `docker compose up -d --build`. Ohne `APP_BIND`
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
`AI_INDEX_INTERVAL_S=0` schaltet den Index ab: dann entstehen keine
Embeddings mehr, „Frag dein Wiki“ sucht nur im Volltext, und Seiten aus
Import oder Vorlagen bekommen erst beim Bearbeiten Abschnitte. Mehrere
Instanzen stimmen sich per Redis-Sperre ab; ist Redis nicht erreichbar,
arbeitet jede für sich (höchstens doppelte Anfragen an Voyage). Log mit
`component: "ai-indexer"`.

### Sicherung und Rückweg

`./scripts/backup.sh` sichert Datenbank und Uploads nach `backups/`
(`db-<Zeitstempel>.dump` und `uploads-<Zeitstempel>.tar.gz`, nur für das
eigene Konto lesbar). Das `APP_SECRET` ist nicht dabei: mit ihm sind die
Zwei-Faktor-Geheimnisse versiegelt, und eine Sicherung allein soll nicht
genügen, um sie zu lesen. Wer kein eigenes `APP_SECRET` in der `.env`
setzt, sichert das automatisch erzeugte einmal getrennt, ausserhalb des
Repositorys und nicht bei den Sicherungen:

    (umask 077; docker compose exec -T app cat /app/data/app_secret > ~/dokunc-app_secret)

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

Die Abschlussmeldung nennt die Datenbanken mit früheren Ständen samt
Löschbefehl, etwa
`docker compose exec db dropdb -U dokunc dokunc_vor_20260925_143512`.

### Update und Rückweg

Migrationen laufen beim Start automatisch und nur vorwärts. Vor jedem
Update deshalb sichern und den bisherigen Stand notieren:

    ./scripts/backup.sh                 # Zeitstempel notieren
    git rev-parse --short HEAD          # bisherigen Stand notieren
    git fetch
    git diff --stat HEAD origin/main -- packages/db/prisma/migrations
    git pull && docker compose up -d --build --wait

Die vierte Zeile zeigt, welche Migrationen das Update mitbringt. Startet
die neue Version nicht (der Container startet immer wieder neu,
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
aktualisieren mit `git checkout main` und den Schritten oben.

## Lokale Entwicklung (ohne Docker)

Voraussetzungen: Node 26 (`.nvmrc`), pnpm, lokal laufendes PostgreSQL 16
mit pg_trgm (bei manchen Distributionen im Paket postgresql-contrib) + Redis.

```bash
nvm use                 # Node 26
pnpm install
cp .env.example .env     # Werte anpassen
pnpm db:migrate          # Schema + Migrationen
pnpm dev                 # web :3000 + collab :3001
```

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
wird. Die Mail verschickt der Dispatcher wie bei Erwähnungen, sofort
gebündelt oder im Tagesdigest. Wer hinter diese Version zurückrollt,
entfernt vorher die Zeilen mit
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
Gruppe oder als Space-Verwaltung. Sie brauchen eine erreichbare
Datenbank und ein erreichbares Redis aus `.env` und legen ihre eigenen
Datensätze an (und wieder ab); sie leeren nichts. Einige starten dafür einen eigenen
Collab-Server (Port 3150 bis 3199, eigene Redis-Datenbank). Solange sie
laufen, darf kein anderer Collab-Server an demselben Redis hängen, etwa
aus `pnpm dev`: Pub/Sub gilt über alle Redis-Datenbanken hinweg, und er
führte die Wiederherstellungen der Tests mit aus. Der Prüf-Collab-Server
läuft mit abgeschaltetem KI-Index. Die Integrationstests nicht neben einem
laufenden `pnpm dev` starten: dessen Hintergrundjobs arbeiten auf derselben
Datenbank.

Der E2E-Lauf startet Web + Collab selbst (bzw. nutzt bereits laufende
Server) und erwartet Postgres + Redis aus `.env`. In Umgebungen mit
vorinstalliertem Chromium: `PW_EXECUTABLE_PATH=/pfad/zu/chromium` setzen.
CI führt alle diese Suiten automatisch aus (`.github/workflows/ci.yml`).
Der Docker-Job spielt dabei eine Sicherung zurück, einmal auf demselben
und einmal auf einem frisch angelegten Stack, und prüft Datenbank,
Uploads, Secret, Sitzungen und Restore-Epoche.

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
- **Space-Bindung** aller Schreibzugriffe: IDs aus Formularen werden gegen
  den Space geprüft, in dem die Person tatsächlich Rechte hat — und gegen
  das, was sie dort sehen darf.
- **Geschützte Seiten** wirken überall gleich: Baum, Suche, Vorschläge,
  Export, Druck, KI-Antworten, Benachrichtigungen und die
  Editor-Verbindung fragen dieselbe Regel. Ein Freigabelink auf eine
  geschützte Seite entsteht gar nicht erst und ein bestehender endet,
  sobald der Schutz gesetzt wird. Die Pfadzeile eines Suchtreffers endet
  an der ersten nicht sichtbaren Elternseite.
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
  fünf Minuten gültiges Cookie — kein Sitzungscookie. Neue
  Wiederherstellungscodes gelten erst, wenn man einen davon zurück
  eintippt: bei der Einrichtung ist der zweite Faktor erst danach aktiv,
  beim Erneuern gelten bis dahin die bisherigen Codes weiter.
  Unbestätigte Codes verfallen nach 30 Minuten.
- **Audit-Log** für Anmeldungen, Rollenwechsel, Einladungen und Löschungen.
- **Anhänge geschützter Seiten**: Jede hochgeladene Datei hängt an
  ihrem Space und, wo bekannt, an ihrer Seite (`Attachment.pageId`).
  `/api/files` liefert sie nur aus, wenn die Person diese Seite sehen
  darf; der Export prüft dasselbe. Anhänge ohne Seitenbezug (ältere
  Uploads, Seiten endgültig gelöscht) sind nur lesbar, wenn mindestens
  eine Seite des Space sie verwendet und die Person jede dieser Seiten
  sehen darf; Freigabelinks liefern sie gar nicht aus.

## Projektstruktur

```
apps/web      Next.js (UI, Auth, API, Editor)
apps/collab   Hocuspocus WebSocket-Server (Yjs-Persistenz)
packages/db   Prisma-Schema + Client + geteilte Zugriffsregeln
packages/editor  Geteilte TipTap-Extensions
packages/mail    Geteilter E-Mail-Versand (Web + Collab)
e2e/          Playwright-E2E-Tests
```
