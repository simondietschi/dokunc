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
#                   Exit 2: sie existieren, ein anderes dokunc-Projekt hat
#                   aber aeltere (Update ohne Festschreiben, schon
#                   gestartet: eine neue, leere Instanz). Entfaellt, wenn
#                   COMPOSE_PROJECT_NAME den Namen ausdruecklich festlegt.
#   --festschreiben schreibt COMPOSE_PROJECT_NAME in die .env: NAME, sonst
#                   den bisherigen, aus dem Verzeichnisnamen abgeleiteten
#                   Namen, wenn es dessen Volumes gibt, sonst den
#                   aktuellen. Aendert nichts, wenn der Name schon in der
#                   .env oder in der Umgebung steht.
#   --name          gibt nur den Namen aus (fuer backup.sh und restore.sh).
# Exit 3: falscher Aufruf, docker compose config gescheitert oder .env
# nicht schreibbar.
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

hat_daten() { docker volume inspect "$1_db_data" "$1_app_data" >/dev/null 2>&1; }

# Anlagedatum der Datenbank eines Projekts, wie Docker es meldet (RFC 3339).
angelegt() { docker volume inspect -f '{{.CreatedAt}}' "$1_db_data" 2>/dev/null | head -n 1; }

# Tag eines Anlagedatums fuer Meldungen.
tag() { if [ -n "$1" ]; then printf '%s' "${1:0:10}"; else printf 'unbekannt'; fi; }

# Sekunden seit 1970 oder leer, wenn das Datum nicht lesbar ist.
sekunden() { date -d "$1" +%s 2>/dev/null || true; }

# dokunc-Projekte des Hosts: Projekte mit einem Compose-Volume app_data
# UND db_data. db_data allein haben auch fremde Projekte.
dokunc_projekte() {
  local app db
  app=$(docker volume ls --filter label=com.docker.compose.volume=app_data \
    --format '{{.Label "com.docker.compose.project"}}' | LC_ALL=C sort -u)
  db=$(docker volume ls --filter label=com.docker.compose.volume=db_data \
    --format '{{.Label "com.docker.compose.project"}}' | LC_ALL=C sort -u)
  LC_ALL=C comm -12 <(printf '%s\n' "$app" | sed '/^$/d') <(printf '%s\n' "$db" | sed '/^$/d')
}

# ---- Aktueller Name und seine Quelle ----

CONFIG_FEHLER=$(mktemp)
trap 'rm -f "$CONFIG_FEHLER"' EXIT
AKTUELL=$(docker compose config 2>"$CONFIG_FEHLER" | sed -n '1s/^name: //p') || true
if [ -z "$AKTUELL" ]; then
  echo "✗ docker compose config gescheitert, der Projektname ist nicht bestimmbar:" >&2
  sed -n '1,10p' "$CONFIG_FEHLER" | sed 's/^/  /' >&2
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
  # In eine Datei neben der .env schreiben und dann ersetzen: bricht der
  # Lauf ab, bleibt die .env, wie sie war. Die Rechte der bestehenden
  # Datei bleiben (cp -p), eine neue entsteht nur fuer den Eigentuemer.
  # Endet die .env ohne Zeilenende, kaeme die neue Zeile sonst an die
  # letzte Variable: aus APP_SECRET=abc wuerde "APP_SECRET=abc# Compose…",
  # Compose laese einen anderen Wert, und alle waeren abgemeldet.
  ZIEL=.env
  if [ -L .env ]; then ZIEL=$(readlink -f .env); fi
  TEIL="$ZIEL.$$.teil"
  trap 'rm -f "$CONFIG_FEHLER" "$TEIL"' EXIT
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
  if hat_daten "$NAME"; then
    echo "✓ COMPOSE_PROJECT_NAME=$NAME in .env eingetragen (Volumes ${NAME}_db_data, ${NAME}_app_data)."
  else
    echo "✓ COMPOSE_PROJECT_NAME=$NAME in .env eingetragen (noch keine Daten)."
  fi
  exit 0
fi

# ---- Pruefen ----

echo "Compose-Projekt: $AKTUELL ($QUELLE)"
ANDERE=()
while IFS= read -r p; do
  [ -n "$p" ] && [ "$p" != "$AKTUELL" ] && ANDERE+=("$p")
done < <(dokunc_projekte)

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

BISHER=$(bisheriger_name)
if [ -z "$EIGENES" ] && [ ${#ANDERE[@]} -gt 0 ]; then
  {
    printf '✗ Für das Compose-Projekt %s gibt es keine Daten, wohl aber für: %s.' "$AKTUELL" "$(liste_andere)"
    if [ "$QUELLE" != "aus docker-compose.yml" ]; then
      printf ' COMPOSE_PROJECT_NAME (%s) nennt %s: stimmt der Name?' "${QUELLE#*, }" "$AKTUELL"
    elif [ "$BISHER" != "$AKTUELL" ] && hat_daten "$BISHER"; then
      printf ' Vermutlich hiess das Projekt bisher %s (Name des Verzeichnisses). Festschreiben mit: ./scripts/projektname.sh --festschreiben' "$BISHER"
    else
      printf ' Den bisherigen Namen festschreiben mit: ./scripts/projektname.sh --festschreiben NAME'
    fi
    printf ' (docs/admin/compose-project.md)\n'
  } >&2
  exit 1
fi

# Eigene Daten, aber ein anderes dokunc-Projekt ist aelter: das sieht nach
# einem Start ohne Festschreiben aus. Steht der Name ausdruecklich fest,
# laufen hier absichtlich mehrere Installationen.
if [ -n "$EIGENES" ] && [ "$QUELLE" = "aus docker-compose.yml" ]; then
  EIGEN_S=$(sekunden "$EIGENES")
  AELTER=()
  for p in "${ANDERE[@]}"; do
    a=$(angelegt "$p")
    s=$(sekunden "$a")
    if [ -n "$EIGEN_S" ] && [ -n "$s" ] && [ "$s" -lt "$EIGEN_S" ]; then
      AELTER+=("$p (angelegt $(tag "$a"))")
    fi
  done
  if [ ${#AELTER[@]} -gt 0 ]; then
    {
      if [ ${#AELTER[@]} -eq 1 ]; then WER="das dokunc-Projekt"; HAT="hat"; else WER="die dokunc-Projekte"; HAT="haben"; fi
      printf '✗ Das Compose-Projekt %s hat Daten (angelegt %s), %s %s %s aber ältere.' \
        "$AKTUELL" "$(tag "$EIGENES")" "$WER" "$(IFS=,; printf '%s' "${AELTER[*]}" | sed 's/,/, /g')" "$HAT"
      printf ' Lief das Update ohne ./scripts/projektname.sh --festschreiben, arbeitet hier eine neue, leere Instanz neben den bisherigen Daten.'
      printf ' Rückweg: docker compose -p %s down (ohne -v), ./scripts/projektname.sh --festschreiben' "$AKTUELL"
      if [ "$BISHER" = "$AKTUELL" ] || ! hat_daten "$BISHER"; then printf ' NAME'; fi
      printf ', docker compose up -d.'
      printf ' Laufen hier absichtlich mehrere Installationen, den Namen in jeder festschreiben (docs/admin/compose-project.md).\n'
    } >&2
    exit 2
  fi
fi
exit 0
