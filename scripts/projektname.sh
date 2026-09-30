#!/usr/bin/env bash
# Nennt und prueft das Compose-Projekt dieser Installation und schreibt
# auf Wunsch den bisherigen Namen in die .env (docs/admin/compose-project.md).
#
# Nutzung: ./scripts/projektname.sh [--festschreiben [NAME] | --name]
#   ohne Option     nennt das Compose-Projekt und prueft, ob seine
#                   Daten-Volumes (<projekt>_db_data, <projekt>_app_data)
#                   existieren.
#                   Exit 1: sie fehlen, ein anderes dokunc-Projekt auf
#                   diesem Host hat aber Daten (Update ohne Festschreiben,
#                   noch nicht gestartet).
#                   Exit 2: sie existieren, aber ein anderes dokunc-Projekt
#                   hat aeltere (Update ohne Festschreiben, schon
#                   gestartet: eine neue, leere Instanz), oder der
#                   bisherige Name des Verzeichnisses hat Daten und das
#                   aktuelle Projekt keine juengeren (es gehoert wohl einer
#                   anderen Installation, up uebernaehme sie). Entfaellt,
#                   wenn COMPOSE_PROJECT_NAME den Namen ausdruecklich
#                   festlegt.
#   --festschreiben schreibt COMPOSE_PROJECT_NAME in die .env: NAME, sonst
#                   den bisherigen, aus dem Verzeichnisnamen abgeleiteten
#                   Namen, wenn es dessen Volumes gibt, sonst den
#                   aktuellen. Aendert nichts, wenn der Name schon in der
#                   .env oder in der Umgebung steht.
#   --name          gibt nur den Namen aus (wie restore.sh ihn bestimmt).
# Exit 3: falscher Aufruf, docker compose config gescheitert, Docker
# nicht erreichbar (eine Abfrage der Volumes scheitert anders als mit "no
# such volume") oder .env nicht schreibbar. Dann ist nichts geaendert.
#
# Warum: docker-compose.yml setzt "name: dokunc". Vorher hiess das Projekt
# wie das Verzeichnis, und die Volumes tragen diesen Namen. Eine
# Installation in einem Verzeichnis, das nicht dokunc heisst, startete
# nach dem Update ohne diesen Schritt eine neue, leere Instanz neben
# ihren Daten.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

nutzung() { echo "Nutzung: ./scripts/projektname.sh [--festschreiben [NAME] | --name]"; }

MODUS=pruefen
WUNSCH=""
case "${1:-}" in
  "") ;;
  --festschreiben)
    MODUS=festschreiben
    if [ $# -gt 2 ]; then nutzung >&2; exit 3; fi
    WUNSCH="${2:-}" ;;
  --name) MODUS=name; if [ $# -gt 1 ]; then nutzung >&2; exit 3; fi ;;
  -h|--help) nutzung; exit 0 ;;
  *) echo "Unbekannte Option: $1" >&2; nutzung >&2; exit 3 ;;
esac
if [ "$MODUS" = pruefen ] && [ $# -gt 0 ]; then nutzung >&2; exit 3; fi

# ---- Hilfen ----

trim() { local v="$1"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"; printf '%s' "$v"; }

# Wert einer Variable in der .env, wie backup.sh sie liest (ohne source:
# fremde Syntax, Leerzeichen in Werten).
env_datei_wert() {
  local zeile wert
  [ -f .env ] || return 0
  zeile=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" .env | tail -n 1) || return 0
  wert=$(trim "${zeile#*=}")
  case "$wert" in
    \"*) wert="${wert#\"}"; wert="${wert%%\"*}" ;;
    \'*) wert="${wert#\'}"; wert="${wert%%\'*}" ;;
    *) wert="${wert%%[[:space:]]#*}" ;;
  esac
  printf '%s' "$wert"
}

# Der Verzeichnisname, wie Compose ihn ohne "name:" zum Projektnamen
# machte: klein, nur a-z, 0-9, "_" und "-", vorne nur Buchstabe oder
# Ziffer ("Mein Wiki.v2" -> meinwikiv2, "_Wiki" -> wiki).
bisheriger_name() {
  basename "$PWD" | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C sed 's/[^a-z0-9_-]//g; s/^[^a-z0-9]*//'
}

# Zulaessiger Projektname fuer Compose.
gueltiger_name() { [[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; }

# Jede Abfrage der Volumes scheitert geschlossen: ohne Zugriff auf Docker
# (ein Benutzer ohne Rechte am Socket, wo docker compose sonst mit sudo
# laeuft, oder ein gestoppter Dienst) saehe sonst jede Installation wie
# eine neue aus, und --festschreiben schriebe den falschen Namen fest.
# docker compose config braucht den Dienst nicht und hilft hier nicht.
docker_gescheitert() {
  {
    echo "✗ $1 gescheitert: ohne Zugriff auf Docker lässt sich nicht prüfen, welche Compose-Projekte Daten haben. Nichts geändert. Läuft docker compose sonst mit sudo, dieses Skript ebenso aufrufen."
    grep -v '^[[:space:]]*$' "$FEHLER" | sed -n '1,10p' | sed 's/^/  /'
  } >&2
  exit 3
}

# Daten eines Projekts: die Volumes <projekt>_db_data und _app_data. Nur
# "no such volume" heisst "fehlt"; jeder andere Fehler bricht ab. Nicht
# in einer Subshell aufrufen, sonst beendet der Abbruch nur diese.
hat_daten() {
  local v
  for v in "$1_db_data" "$1_app_data"; do
    if ! docker volume inspect "$v" >/dev/null 2>"$FEHLER"; then
      if grep -qi 'no such volume' "$FEHLER"; then return 1; fi
      docker_gescheitert "docker volume inspect $v"
    fi
  done
  return 0
}

# Anlagedatum der Datenbank eines Projekts, wie Docker es meldet (RFC 3339).
angelegt() { docker volume inspect -f '{{.CreatedAt}}' "$1_db_data" 2>/dev/null | head -n 1; }

# Tag eines Anlagedatums fuer Meldungen.
tag() { if [ -n "$1" ]; then printf '%s' "${1:0:10}"; else printf 'unbekannt'; fi; }

# Sekunden seit 1970 oder leer, wenn das Datum nicht lesbar ist. Docker
# meldet RFC 3339 in der Zeitzone des Dienstes ("2026-05-19T08:00:00Z",
# "…+02:00", auch mit Bruchteilen). GNU date liest das mit -d; BSD date
# (macOS) kennt -d nicht und braucht -j -f mit festem Format, ohne
# Bruchteile und ohne Doppelpunkt im Versatz.
sekunden() {
  local t
  [ -n "$1" ] || return 0
  if date -d "$1" +%s 2>/dev/null; then return 0; fi
  t=$(printf '%s' "$1" | sed -E 's/\.[0-9]+//; s/Z$/+0000/; s/([+-][0-9]{2}):([0-9]{2})$/\1\2/')
  date -j -f '%Y-%m-%dT%H:%M:%S%z' "$t" +%s 2>/dev/null || true
}

# Hinweis, wenn ein Anlagedatum ($2 von Projekt $1) nicht lesbar ist.
unlesbar() {
  printf 'Hinweis: Das Anlagedatum von %s (%s) lässt sich nicht lesen; ob ein anderes dokunc-Projekt ältere Daten hat, bleibt ungeprüft. Den Namen festschreiben, wenn hier mehrere Installationen laufen (docs/admin/compose-project.md).\n' \
    "$1" "${2:-unbekannt}" >&2
}

# Compose-Projekte mit einem Volume der Art $1 (app_data, db_data,
# uploads), sortiert, eines je Zeile.
projekte_mit() {
  docker volume ls --filter "label=com.docker.compose.volume=$1" \
    --format '{{.Label "com.docker.compose.project"}}' 2>"$FEHLER" | sed '/^$/d' | LC_ALL=C sort -u
}

# ---- Aktueller Name und seine Quelle ----

FEHLER=$(mktemp)
trap 'rm -f "$FEHLER"' EXIT
AKTUELL=$(docker compose config 2>"$FEHLER" | sed -n '1s/^name: //p') || true
if [ -z "$AKTUELL" ]; then
  echo "✗ docker compose config gescheitert, der Projektname ist nicht bestimmbar:" >&2
  sed -n '1,10p' "$FEHLER" | sed 's/^/  /' >&2
  exit 3
fi
if [ "$MODUS" = name ]; then
  printf '%s\n' "$AKTUELL"
  exit 0
fi

IN_UMGEBUNG=$(trim "${COMPOSE_PROJECT_NAME:-}")
IN_DATEI=$(trim "$(env_datei_wert COMPOSE_PROJECT_NAME)")
if [ -n "$IN_UMGEBUNG" ]; then
  QUELLE="aus der Umgebung, COMPOSE_PROJECT_NAME"
elif [ -n "$IN_DATEI" ]; then
  QUELLE="aus .env, COMPOSE_PROJECT_NAME"
else
  QUELLE="aus docker-compose.yml"
fi

# ---- Festschreiben ----

if [ "$MODUS" = festschreiben ]; then
  if [ -n "$WUNSCH" ] && ! gueltiger_name "$WUNSCH"; then
    echo "✗ Ungültiger Projektname: $WUNSCH (nur a-z, 0-9, _ und -, vorne Buchstabe oder Ziffer)." >&2
    exit 3
  fi
  if [ -n "$IN_UMGEBUNG" ] || [ -n "$IN_DATEI" ]; then
    if [ -n "$WUNSCH" ] && [ "$WUNSCH" != "$AKTUELL" ]; then
      echo "✗ COMPOSE_PROJECT_NAME ist schon gesetzt ($AKTUELL, $QUELLE). Von Hand ändern, wenn $WUNSCH gemeint ist." >&2
      exit 3
    fi
    echo "✓ COMPOSE_PROJECT_NAME ist schon gesetzt: $AKTUELL ($QUELLE). Nichts geändert."
    exit 0
  fi
  if [ -n "$WUNSCH" ]; then
    if ! hat_daten "$WUNSCH"; then
      echo "✗ Für das Compose-Projekt $WUNSCH gibt es keine Daten (${WUNSCH}_db_data, ${WUNSCH}_app_data). Nichts geändert." >&2
      exit 1
    fi
    NAME=$WUNSCH
  else
    BISHER=$(bisheriger_name)
    if [ -n "$BISHER" ] && [ "$BISHER" != "$AKTUELL" ] && hat_daten "$BISHER"; then
      NAME=$BISHER
    else
      NAME=$AKTUELL
    fi
  fi
  # Auch hier vor dem Schreiben fragen: ohne Docker bricht es jetzt ab,
  # nicht erst nach dem Eintrag.
  if hat_daten "$NAME"; then NAME_HAT_DATEN=1; else NAME_HAT_DATEN=0; fi
  # In eine Datei neben der .env schreiben und dann ersetzen: bricht der
  # Lauf ab, bleibt die .env, wie sie war. Die Rechte der bestehenden
  # Datei bleiben (cp -p), eine neue entsteht nur fuer den Eigentuemer.
  # Endet die .env ohne Zeilenende, kaeme die neue Zeile sonst an die
  # letzte Variable: aus APP_SECRET=abc wuerde "APP_SECRET=abc# Compose…",
  # Compose laese einen anderen Wert, und alle waeren abgemeldet.
  ZIEL=.env
  if [ -L .env ]; then ZIEL=$(readlink -f .env); fi
  TEIL="$ZIEL.$$.teil"
  trap 'rm -f "$FEHLER" "$TEIL"' EXIT
  if [ -e "$ZIEL" ]; then
    cp -p "$ZIEL" "$TEIL"
    if [ -s "$TEIL" ] && [ -n "$(tail -c 1 "$TEIL")" ]; then printf '\n' >>"$TEIL"; fi
  else
    (umask 077 && : >"$TEIL")
  fi
  {
    echo "# Compose-Projekt dieser Installation (scripts/projektname.sh)"
    echo "COMPOSE_PROJECT_NAME=$NAME"
  } >>"$TEIL"
  mv "$TEIL" "$ZIEL" || { echo "✗ .env nicht schreibbar." >&2; exit 3; }
  if [ "$NAME_HAT_DATEN" -eq 1 ]; then
    echo "✓ COMPOSE_PROJECT_NAME=$NAME in .env eingetragen (Volumes ${NAME}_db_data, ${NAME}_app_data)."
  else
    echo "✓ COMPOSE_PROJECT_NAME=$NAME in .env eingetragen (noch keine Daten)."
  fi
  exit 0
fi

# ---- Pruefen ----

echo "Compose-Projekt: $AKTUELL ($QUELLE)"
# dokunc-Projekte des Hosts: Projekte mit den Compose-Volumes app_data,
# db_data UND uploads. db_data allein oder mit app_data haben auch fremde
# Anwendungen; sie hier mitzuzaehlen, liesse die Pruefung auf solchen
# Hosts dauernd anschlagen und die Aufbewahrung in backup.sh ruhen.
MIT_APP=$(projekte_mit app_data) || docker_gescheitert "docker volume ls"
MIT_DB=$(projekte_mit db_data) || docker_gescheitert "docker volume ls"
MIT_UPLOADS=$(projekte_mit uploads) || docker_gescheitert "docker volume ls"
ANDERE=()
while IFS= read -r p; do
  [ -n "$p" ] && [ "$p" != "$AKTUELL" ] && ANDERE+=("$p")
done < <(LC_ALL=C comm -12 <(printf '%s\n' "$MIT_APP") <(printf '%s\n' "$MIT_DB") \
  | LC_ALL=C comm -12 - <(printf '%s\n' "$MIT_UPLOADS"))

# Der Name, den dieses Verzeichnis vor "name: dokunc" hatte, und ob er
# Daten hat. Zaehlt auch ohne die Labels von Compose (Volumes, die jemand
# von Hand angelegt und zurueckgespielt hat). Steht der Name fest, spielt
# der bisherige keine Rolle.
BISHER=$(bisheriger_name)
BISHER_HAT_DATEN=0
if [ "$QUELLE" = "aus docker-compose.yml" ] && [ -n "$BISHER" ] && [ "$BISHER" != "$AKTUELL" ] \
  && hat_daten "$BISHER"; then
  BISHER_HAT_DATEN=1
  if ! printf '%s\n' "${ANDERE[@]}" | grep -qxF -- "$BISHER"; then ANDERE+=("$BISHER"); fi
fi

# "wiki (angelegt 2026-05-19)" je anderem Projekt, durch Komma getrennt.
liste_andere() {
  local p a teile=()
  for p in "${ANDERE[@]}"; do
    a=$(angelegt "$p")
    teile+=("$p (angelegt $(tag "$a"))")
  done
  local IFS=,
  printf '%s' "${teile[*]}" | sed 's/,/, /g'
}

if hat_daten "$AKTUELL"; then
  EIGENES=$(angelegt "$AKTUELL")
  echo "Daten: vorhanden (${AKTUELL}_db_data, ${AKTUELL}_app_data, angelegt $(tag "$EIGENES"))"
else
  EIGENES=""
  echo "Noch keine Daten (neue Installation)."
fi
if [ ${#ANDERE[@]} -gt 0 ]; then
  echo "Weitere dokunc-Projekte auf diesem Host: $(liste_andere)"
fi

if [ -z "$EIGENES" ] && [ ${#ANDERE[@]} -gt 0 ]; then
  {
    printf '✗ Für das Compose-Projekt %s gibt es keine Daten, wohl aber für: %s.' "$AKTUELL" "$(liste_andere)"
    if [ "$QUELLE" != "aus docker-compose.yml" ]; then
      printf ' COMPOSE_PROJECT_NAME (%s) nennt %s: stimmt der Name?' "${QUELLE#*, }" "$AKTUELL"
    elif [ "$BISHER_HAT_DATEN" -eq 1 ]; then
      printf ' Vermutlich hiess das Projekt bisher %s (Name des Verzeichnisses). Festschreiben mit: ./scripts/projektname.sh --festschreiben' "$BISHER"
    else
      printf ' Den bisherigen Namen festschreiben mit: ./scripts/projektname.sh --festschreiben NAME'
    fi
    printf ' (docs/admin/compose-project.md)\n'
  } >&2
  exit 1
fi

# Eigene Daten ohne festen Namen. Steht der Name ausdruecklich fest,
# laufen hier absichtlich mehrere Installationen.
if [ -n "$EIGENES" ] && [ "$QUELLE" = "aus docker-compose.yml" ]; then
  EIGEN_S=$(sekunden "$EIGENES")
  if [ -z "$EIGEN_S" ] && [ ${#ANDERE[@]} -gt 0 ]; then unlesbar "$AKTUELL" "$EIGENES"; fi
  # Anlagedatum $1 liegt vor dem der eigenen Daten.
  aelter() { local s; s=$(sekunden "$1"); [ -n "$EIGEN_S" ] && [ -n "$s" ] && [ "$s" -lt "$EIGEN_S" ]; }
  AELTER=()
  for p in "${ANDERE[@]}"; do
    a=$(angelegt "$p")
    if [ -n "$EIGEN_S" ] && [ -z "$(sekunden "$a")" ]; then unlesbar "$p" "$a"; fi
    if aelter "$a"; then AELTER+=("$p (angelegt $(tag "$a"))"); fi
  done

  # Der bisherige Name hat Daten, das Projekt aus docker-compose.yml
  # aber nicht juengere: es gehoert vermutlich einer anderen Installation
  # (etwa einer aelteren im Verzeichnis dokunc). up uebernaehme deren
  # Container und fuehrte die Migrationen gegen deren Datenbank aus; ein
  # down dort hielte die andere Installation an.
  if [ "$BISHER_HAT_DATEN" -eq 1 ] && ! aelter "$(angelegt "$BISHER")"; then
    {
      printf '✗ Dieses Verzeichnis gehörte bisher zum Compose-Projekt %s (angelegt %s),' "$BISHER" "$(tag "$(angelegt "$BISHER")")"
      printf ' docker-compose.yml nennt jetzt %s, und dieses Projekt hat eigene Daten (angelegt %s):' "$AKTUELL" "$(tag "$EIGENES")"
      printf ' vermutlich eine andere Installation auf diesem Host. docker compose up übernähme hier deren Container und Datenbank.'
      printf ' Festschreiben mit: ./scripts/projektname.sh --festschreiben (schreibt %s).' "$BISHER"
      printf ' Lief docker compose up hier schon, danach docker compose up -d hier und im Verzeichnis der anderen Installation.'
      printf ' Ist %s doch richtig: ./scripts/projektname.sh --festschreiben %s (docs/admin/compose-project.md)\n' "$AKTUELL" "$AKTUELL"
    } >&2
    exit 2
  fi

  # Ein anderes dokunc-Projekt ist aelter: das sieht nach einem Start
  # ohne Festschreiben aus, hier arbeitet eine neue, leere Instanz.
  if [ ${#AELTER[@]} -gt 0 ]; then
    {
      if [ ${#AELTER[@]} -eq 1 ]; then WER="das dokunc-Projekt"; HAT="hat"; else WER="die dokunc-Projekte"; HAT="haben"; fi
      printf '✗ Das Compose-Projekt %s hat Daten (angelegt %s), %s %s %s aber ältere.' \
        "$AKTUELL" "$(tag "$EIGENES")" "$WER" "$(IFS=,; printf '%s' "${AELTER[*]}" | sed 's/,/, /g')" "$HAT"
      printf ' Lief das Update ohne ./scripts/projektname.sh --festschreiben, arbeitet hier eine neue, leere Instanz neben den bisherigen Daten.'
      printf ' Rückweg: docker compose -p %s down (ohne -v), ./scripts/projektname.sh --festschreiben' "$AKTUELL"
      if [ "$BISHER_HAT_DATEN" -eq 0 ]; then printf ' NAME'; fi
      printf ', docker compose up -d.'
      printf ' Laufen hier absichtlich mehrere Installationen, den Namen in jeder festschreiben (docs/admin/compose-project.md).\n'
    } >&2
    exit 2
  fi
fi
exit 0
