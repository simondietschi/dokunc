#!/usr/bin/env bash
# Sichert PostgreSQL (custom dump) und den Uploads-Ordner nach backups/,
# prueft beides und loescht auf Wunsch alte Saetze.
# Nutzung: ./scripts/backup.sh [--secret-sichern DATEI]
#   ohne Option            Datenbank und Uploads sichern (der Dienst db muss
#                          laufen, die App darf angehalten sein)
#   --secret-sichern DATEI nur das automatisch erzeugte APP_SECRET nach DATEI
#                          schreiben, ausserhalb des Repositorys; sichert sonst
#                          nichts (README "Sicherung und Rueckweg")
# Umgebung oder .env: BACKUP_KEEP_DAYS (Vorgabe 0: nie loeschen)
# Ausgabe: Fortschritt auf stdout, Fehler und Warnungen auf stderr (cron:
# >/dev/null, gemailt wird nur, was Aufmerksamkeit braucht). Meldungen,
# nach denen Tests oder die CI suchen, stehen auf einer Zeile.
set -Eeuo pipefail
AUFRUFORT=$PWD
cd "$(dirname "$0")/.."
umask 077

nutzung() { echo "Nutzung: ./scripts/backup.sh [--secret-sichern DATEI]"; }

SECRET_ZIEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --secret-sichern)
      if [ $# -lt 2 ] || [ -z "$2" ]; then nutzung >&2; exit 2; fi
      SECRET_ZIEL="$2"; shift ;;
    -h|--help) nutzung; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; nutzung >&2; exit 2 ;;
  esac
  shift
done

mkdir -p backups
chmod 700 backups
# stderr jedes Docker-Aufrufs landet hier: docker compose run schreibt
# "Container ... Creating/Created" auf stderr, das ginge sonst an cron.
FEHLER="backups/.fehler.$$"
TEILE=("$FEHLER")
aufraeumen() { rm -f "${TEILE[@]}"; }
trap aufraeumen EXIT
trap 'exit 130' INT TERM

# scheitern MELDUNG [log]: "✗ MELDUNG" auf stderr, Exit 1. Mit "log" folgt
# die Fehlerausgabe des letzten Docker-Aufrufs, ohne die Fortschrittszeilen
# von compose run und ohne Leerzeilen, hoechstens 20 Zeilen.
scheitern() {
  echo "✗ $1" >&2
  if [ "${2:-}" = log ]; then fehlerauszug; fi
  exit 1
}
fehlerauszug() {
  [ -s "$FEHLER" ] || return 0
  grep -vE '^[[:space:]]*(Container .* (Creating|Created|Starting|Started)[[:space:]]*)?$' "$FEHLER" \
    | sed -n '1,20p' | sed 's/^/  /' >&2 || true
}

# Merkmal des Secrets im Volume, nie das Secret selbst und nie
# sha256(Secret): das waere genau der Schluessel von secret-box.ts, und
# das Merkmal liegt in backups/. Mit dem Praefix ist es ein anderer Wert,
# aus dem sich weder Secret (48 Zufallsbytes) noch Schluessel gewinnen
# lassen. Zeilenenden am Ende zaehlen nicht, wie bei APP_SECRET="$(cat ...)"
# in docker-entrypoint.sh. Ausgabe: "env", "fehlt" oder "merkmal <hex>".
secret_lage() {
  docker compose run --rm --no-deps -T --entrypoint node app -e '
    const fs = require("node:fs");
    const c = require("node:crypto");
    if (process.env.APP_SECRET) { console.log("env"); process.exit(0); }
    let s;
    try { s = fs.readFileSync("/app/data/app_secret", "utf8"); } catch { console.log("fehlt"); process.exit(0); }
    s = s.replace(/\n+$/, "");
    if (!s.trim()) { console.log("fehlt"); process.exit(0); }
    console.log("merkmal " + c.createHash("sha256").update("dokunc-backup-merkmal-v1\n").update(s).digest("hex"));
  ' </dev/null 2>"$FEHLER"
}
MERKMAL_DATEI="backups/.app_secret-merkmal"

# Gleiches Secret, Zeilenenden am Ende ausgenommen ($(cat) schneidet sie
# ab, wie der Entrypoint). Nur Builtins: das Secret erscheint in keiner
# Befehlszeile.
gleiches_secret() { [ "$(cat "$1")" = "$(cat "$2")" ]; }

if [ -n "$SECRET_ZIEL" ]; then
  [[ "$SECRET_ZIEL" == /* ]] || SECRET_ZIEL="$AUFRUFORT/$SECRET_ZIEL"
  if [ -d "$SECRET_ZIEL" ]; then
    scheitern "$SECRET_ZIEL ist ein Ordner. Einen Dateinamen angeben, etwa ~/dokunc-app_secret."
  fi
  ZIEL_ORDNER=$(cd "$(dirname "$SECRET_ZIEL")" 2>/dev/null && pwd -P) \
    || scheitern "Ordner fehlt: $(dirname "$SECRET_ZIEL")"
  REPO=$(pwd -P)
  case "$ZIEL_ORDNER/" in
    "$REPO"/*) scheitern "Das Secret gehört nicht ins Repository und nicht zu den Sicherungen. Einen Pfad ausserhalb wählen, etwa ~/dokunc-app_secret." ;;
  esac
  ZIEL="$ZIEL_ORDNER/$(basename "$SECRET_ZIEL")"
  LAGE=$(secret_lage) || scheitern "APP_SECRET liess sich nicht lesen (docker compose run app gescheitert)." log
  case "$LAGE" in
    env) scheitern "APP_SECRET steht in der .env und hat Vorrang, das Secret im Volume wird nicht verwendet. Die .env getrennt sichern." ;;
    fehlt) scheitern "Im Volume app_data liegt kein APP_SECRET. Die App einmal starten (docker compose up -d)." ;;
    merkmal\ ?*) ;;
    *) scheitern "APP_SECRET liess sich nicht lesen (unerwartete Antwort von docker compose run app)." log ;;
  esac
  # Zwischendatei im Zielordner (0600 durch umask), Name <Ziel>.<pid>.teil
  TEIL="$ZIEL.$$.teil"
  TEILE+=("$TEIL")
  docker compose run --rm --no-deps -T --entrypoint cat app /app/data/app_secret \
    </dev/null >"$TEIL" 2>"$FEHLER" || scheitern "APP_SECRET liess sich nicht lesen (docker compose run app gescheitert)." log
  if [ "$(tr -d '\n' <"$TEIL" | wc -c)" -lt 32 ]; then
    scheitern "Das Secret im Volume ist kürzer als 32 Zeichen."
  fi
  if [ -e "$ZIEL" ]; then
    if gleiches_secret "$TEIL" "$ZIEL"; then
      echo "✓ $ZIEL enthält schon dieses APP_SECRET."
    else
      scheitern "$ZIEL enthält ein anderes Secret und bleibt unverändert: es kann für ältere Sicherungen noch nötig sein. Eine andere Datei wählen."
    fi
  else
    mv "$TEIL" "$ZIEL"
    echo "✓ APP_SECRET gesichert: $ZIEL"
  fi
  printf '%s\n' "${LAGE#merkmal }" >"$MERKMAL_DATEI"
  echo "  Getrennt von den Sicherungen aufbewahren (Passwortmanager oder anderer Datenträger)."
  echo "  Zurücklegen mit ./scripts/restore.sh --secret $ZIEL <Zeitstempel>"
  exit 0
fi

# ---- BACKUP_KEEP_DAYS ----
# Regel wie readWholeNumber (packages/editor/src/env-number.ts), das hier
# nicht nutzbar ist: leer = keine Angabe; nur Ziffern; sonst Warnung und
# nichts loeschen. Umgebung vor .env (wie bei docker compose). Die .env
# wird nicht per source gelesen (fremde Syntax, Leerzeichen in Werten).
trim() { local v="$1"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"; printf '%s' "$v"; }
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
ROH=$(trim "${BACKUP_KEEP_DAYS:-}")
[ -n "$ROH" ] || ROH=$(trim "$(env_datei_wert BACKUP_KEEP_DAYS)")
TAGE=0
if [ -n "$ROH" ]; then
  if ! [[ "$ROH" =~ ^[0-9]+$ ]]; then
    echo "Warnung: Ungültiger Wert für BACKUP_KEEP_DAYS (${ROH:0:40}), es wird keine Sicherung gelöscht." >&2
  else
    # Fuehrende Nullen zuerst weg: "000014" ist 14, und ohne sie liest
    # Bash spaeter nichts als Oktalzahl ("09" waere ein Fehler).
    ZAHL="${ROH#"${ROH%%[!0]*}"}"
    [ -n "$ZAHL" ] || ZAHL=0
    if [ "${#ZAHL}" -gt 5 ] || [ "$ZAHL" -gt 36500 ]; then
      echo "Warnung: BACKUP_KEEP_DAYS (${ROH:0:40}) auf 36500 gekappt." >&2
      TAGE=36500
    else
      TAGE=$ZAHL
    fi
  fi
fi

# Reste abgebrochener Laeufe (kill -9), erst nach einem Tag, damit ein
# gleichzeitig laufender zweiter Lauf nicht gestoert wird.
find backups -maxdepth 1 \( -name '.*.teil' -o -name '.fehler.*' -o -name '.liste.*' \) \
  -mmin +1440 -exec rm -f {} + 2>/dev/null || true

TS="$(date +%Y%m%d-%H%M%S)"
DUMP="backups/db-${TS}.dump"
UPLOADS="backups/uploads-${TS}.tar.gz"
TEIL_DUMP="backups/.db-${TS}.dump.$$.teil"
TEIL_UPLOADS="backups/.uploads-${TS}.tar.gz.$$.teil"
LISTE="backups/.liste.$$"
TEILE+=("$TEIL_DUMP" "$TEIL_UPLOADS" "$LISTE")

echo "→ Datenbank-Dump…"
docker compose exec -T db pg_dump -U dokunc -Fc dokunc </dev/null >"$TEIL_DUMP" 2>"$FEHLER" \
  || scheitern "Datenbank-Dump gescheitert (pg_dump), keine Sicherung angelegt." log

echo "→ Uploads…"
docker compose run --rm --no-deps -T --entrypoint tar app czf - -C /app/uploads . \
  </dev/null >"$TEIL_UPLOADS" 2>"$FEHLER" \
  || scheitern "Uploads packen gescheitert (tar), keine Sicherung angelegt." log

echo "→ Sicherung prüfen…"
[ -s "$TEIL_DUMP" ] || scheitern "Dump ist leer, keine Sicherung angelegt."
docker compose exec -T db pg_restore --list <"$TEIL_DUMP" >"$LISTE" 2>"$FEHLER" \
  || scheitern "Dump unlesbar (pg_restore --list), keine Sicherung angelegt." log
# restore.sh braucht genau diese Tabelle; ohne sie ist es kein dokunc-Dump.
grep -Eq 'TABLE DATA public _prisma_migrations( |$)' "$LISTE" \
  || scheitern "Dump enthält die Tabelle _prisma_migrations nicht, keine Sicherung angelegt."
# --list liest nur das Inhaltsverzeichnis und haelt einen gekuerzten Dump
# fuer gut; erst ein vollstaendiges Lesen findet das Ende.
docker compose exec -T db pg_restore -f /dev/null <"$TEIL_DUMP" 2>"$FEHLER" \
  || scheitern "Dump unvollständig (pg_restore), keine Sicherung angelegt." log
[ -s "$TEIL_UPLOADS" ] || scheitern "Uploads-Archiv ist leer, keine Sicherung angelegt."
tar tzf "$TEIL_UPLOADS" >/dev/null 2>"$FEHLER" \
  || scheitern "Uploads-Archiv unvollständig (tar tzf), keine Sicherung angelegt." log

# Zwei Laeufe in derselben Sekunde (cron und Hand) duerften einen Satz
# nicht halb ueberschreiben. Zwischen Pruefung und mv bleibt ein Fenster
# von Millisekunden.
if [ -e "$DUMP" ] || [ -e "$UPLOADS" ]; then
  scheitern "Eine Sicherung mit dem Zeitstempel $TS gibt es schon (zweiter Lauf in derselben Sekunde?). Erneut starten."
fi
mv "$TEIL_UPLOADS" "$UPLOADS"
mv "$TEIL_DUMP" "$DUMP"   # zuletzt: der Dump kennzeichnet den Satz

echo "✓ Fertig:"
echo "  backups/db-${TS}.dump"
echo "  backups/uploads-${TS}.tar.gz"
echo
echo "Wiederherstellen:"
echo "  ./scripts/restore.sh ${TS}"

# ---- Aufbewahrung: nur nach Erfolg, nur nach Namensmuster ----
# Massgeblich ist der Zeitstempel im Namen (mtime aendert sich beim
# Kopieren). Die drei juengsten Saetze bleiben immer, auch wenn sie aelter
# als die Frist sind: nach einer vorgestellten Uhr oder einer langen Pause
# bliebe sonst nur der eben geschriebene.
if [ "$TAGE" -gt 0 ]; then
  GRENZE_S=$(( $(date +%s) - TAGE * 86400 ))
  GRENZE=$(date -d "@$GRENZE_S" +%Y%m%d%H%M%S 2>/dev/null || date -r "$GRENZE_S" +%Y%m%d%H%M%S)
  ALLE=""
  for f in backups/db-*.dump backups/uploads-*.tar.gz; do
    [[ "$f" =~ ^backups/(db|uploads)-([0-9]{8}-[0-9]{6})\.(dump|tar\.gz)$ ]] && ALLE="$ALLE ${BASH_REMATCH[2]}"
  done
  # Wortzerlegung gewollt: die Zeitstempel enthalten nur Ziffern und "-".
  # shellcheck disable=SC2086
  JUENGSTE=" $(printf '%s\n' $ALLE | sort -u -r | sed -n '1,3p' | tr '\n' ' ')"
  GELOESCHT=""
  for f in backups/db-*.dump backups/uploads-*.tar.gz; do
    [ -f "$f" ] || continue
    [[ "$f" =~ ^backups/(db|uploads)-([0-9]{8}-[0-9]{6})\.(dump|tar\.gz)$ ]] || continue
    t="${BASH_REMATCH[2]}"
    [ "$t" != "$TS" ] || continue
    case "$JUENGSTE" in *" $t "*) continue ;; esac
    if [ "${t//-/}" -lt "$GRENZE" ]; then
      if rm -f "$f"; then GELOESCHT="$GELOESCHT $t"; else echo "Warnung: $f liess sich nicht löschen." >&2; fi
    fi
  done
  if [ -n "$GELOESCHT" ]; then
    # Nur Zeitstempel, keine Dateinamen: die Zeile backups/db-<TS>.dump
    # oben muss die einzige ihrer Form bleiben (restore.sh, CI).
    # Wortzerlegung gewollt, wie oben.
    # shellcheck disable=SC2086
    echo "Gelöscht (älter als $TAGE Tage): $(printf '%s\n' $GELOESCHT | sort -u | tr '\n' ' ' | sed 's/ $//')"
  fi
fi

# ---- Hinweis zum APP_SECRET ----
if LAGE=$(secret_lage); then :; else LAGE="aufruf-gescheitert"; fi
case "$LAGE" in
  env) echo "APP_SECRET steht in der .env: die .env getrennt von den Sicherungen aufbewahren." ;;
  merkmal\ *)
    if [ -f "$MERKMAL_DATEI" ] && [ "$(cat "$MERKMAL_DATEI")" = "${LAGE#merkmal }" ]; then
      echo "APP_SECRET: getrennt gesichert (nicht Teil dieser Sicherung)."
    elif [ -f "$MERKMAL_DATEI" ]; then
      echo "Warnung: Das APP_SECRET im Volume app_data ist ein anderes als bei der letzten getrennten Sicherung (--secret-sichern). Zwei-Faktor-Geheimnisse aus der Zeit davor lassen sich nur mit dem alten Secret lesen: das alte nicht löschen und das neue in eine neue Datei sichern: ./scripts/backup.sh --secret-sichern ~/dokunc-app_secret-$(date +%Y%m%d)" >&2
    else
      echo "Warnung: Nicht enthalten ist das automatisch erzeugte APP_SECRET (Volume app_data). Ohne es lassen sich auf einem neuen Host die Zwei-Faktor-Geheimnisse nicht mehr entsiegeln. Einmal getrennt sichern, ausserhalb des Repositorys: ./scripts/backup.sh --secret-sichern ~/dokunc-app_secret" >&2
    fi
    ;;
  fehlt) echo "Warnung: APP_SECRET weder in der .env noch im Volume app_data gefunden." >&2 ;;
  *)
    echo "Warnung: APP_SECRET liess sich nicht prüfen (docker compose run app gescheitert)." >&2
    fehlerauszug
    ;;
esac
