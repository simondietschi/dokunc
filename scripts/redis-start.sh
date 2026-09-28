#!/bin/sh
# Startet Redis mit Passwort (docker-compose.yml, Dienst redis, als
# entrypoint vor dem des Images). Wie beim APP_SECRET: beim ersten Start
# ein zufaelliges Passwort erzeugen und im Volume redis_auth ablegen; die
# App liest es von dort (REDIS_PASSWORD_FILE in docker-entrypoint.sh). Ohne
# .env und ohne Handarbeit, auch beim Update einer bestehenden Instanz.
#
# Das Passwort steht in keiner Befehlszeile: Redis liest es ueber
# --include aus redis.conf. --include kommt ans Ende, damit es auch nach
# einer eigenen Konfigurationsdatei oder eigenen Optionen gilt (command in
# einer docker-compose.override.yml).
#
# Ausnahme: steht --requirepass schon im command (eine Installation, die
# Redis vor diesem Skript selbst geschuetzt hat, mit eigener REDIS_URL fuer
# die App), gilt dieses Passwort weiter. Es kommt nur in die Passwortdatei,
# damit Healthcheck und redis-cli-Anleitung stimmen. Faellt --requirepass
# spaeter weg und hat das Passwort Zeichen, die REDIS_URL nicht ohne
# Kodierung traegt, entsteht ein neues (Merker aus-requirepass): sonst
# startete Redis nicht mehr, bis jemand die Datei von Hand loescht.
#
# Neues Passwort: docker compose exec redis rm /run/redis-auth/password,
# dann docker compose up -d --force-recreate redis app.
# REDIS_AUTH_DIR nur fuer den Test (apps/web/src/container-start.test.ts).
set -eu

DIR="${REDIS_AUTH_DIR:-/run/redis-auth}"
PASSWORT="$DIR/password"
MERKER="$DIR/aus-requirepass"

# Wie der Einstieg des Images: beginnt der Befehl mit einer Option oder
# einer Konfigurationsdatei, ist redis-server gemeint.
case "${1:-}" in
  -*|*.conf) set -- redis-server "$@" ;;
esac
case "${1:-}" in
  redis-server|*/redis-server) ;;
  # Andere Befehle (redis-cli, sh) unveraendert
  *) exec docker-entrypoint.sh "$@" ;;
esac

EIGENES=
NIMM=
for a in "$@"; do
  if [ -n "$NIMM" ]; then
    EIGENES="$a"
    NIMM=
  elif [ "$a" = --requirepass ]; then
    NIMM=1
  fi
done

# Das Volume gehoert root: mit user: aus einer override-Datei scheiterte
# sonst der erste Schreibversuch mit einer blossen Shell-Meldung.
if ! (: > "$DIR/.schreibprobe") 2>/dev/null; then
  echo "dokunc: $DIR ist nicht beschreibbar (Redis startet als Nutzer $(id -u)). user: fuer redis aus der docker-compose.override.yml entfernen: der Start legt das Passwort als root an, der Einstieg des Images wechselt danach selbst zum Nutzer redis." >&2
  exit 1
fi
rm -f "$DIR/.schreibprobe"

umask 022
if [ -n "$EIGENES" ]; then
  printf '%s' "$EIGENES" > "$PASSWORT.neu"
  mv "$PASSWORT.neu" "$PASSWORT"
  : > "$MERKER"
  echo "dokunc: Redis-Passwort aus --requirepass uebernommen ($PASSWORT)."
  exec docker-entrypoint.sh "$@"
fi

if [ -e "$MERKER" ]; then
  case "$(cat "$PASSWORT" 2>/dev/null || true)" in
    ''|*[!0-9A-Za-z._~-]*)
      echo "dokunc: Passwort aus dem frueheren --requirepass passt nicht in REDIS_URL, ein neues wird erzeugt."
      rm -f "$PASSWORT" ;;
  esac
  rm -f "$MERKER"
fi
if [ ! -s "$PASSWORT" ]; then
  # 32 Zufallsbytes als Hex: nur Zeichen, die in REDIS_URL ohne Kodierung
  # stehen duerfen.
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$PASSWORT.neu"
  mv "$PASSWORT.neu" "$PASSWORT"
  echo "dokunc: Redis-Passwort erzeugt ($PASSWORT)."
fi
WERT="$(cat "$PASSWORT")"
case "$WERT" in
  ''|*[!0-9A-Za-z._~-]*)
    echo "dokunc: $PASSWORT enthaelt kein gueltiges Redis-Passwort (erlaubt: Buchstaben, Ziffern und . _ ~ -). Datei loeschen, beim naechsten Start entsteht ein neues." >&2
    exit 1 ;;
esac
# Lesbar fuer Redis und die App (Nutzer node), auch wenn die Datei von Hand
# mit engeren Rechten angelegt wurde. Das Volume haengt nur an diesen
# beiden Diensten.
chmod 0644 "$PASSWORT"
printf 'requirepass %s\n' "$WERT" > "$DIR/redis.conf.neu"
mv "$DIR/redis.conf.neu" "$DIR/redis.conf"

exec docker-entrypoint.sh "$@" --include "$DIR/redis.conf"
