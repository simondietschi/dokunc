#!/bin/sh
# Startvorbereitung im Container — sorgt dafür, dass ein frisch geklontes
# Repo mit `docker compose up -d` ohne weitere Handgriffe läuft.
#
# APP_SECRET ist Pflicht (Sessions + Collab-Auth werden damit signiert).
# Ist keines gesetzt, wird EINMALIG ein zufälliges erzeugt und im Volume
# unter /app/data abgelegt — es überlebt Neustarts und Updates, sodass
# angemeldete Sitzungen gültig bleiben. Ein per Umgebung gesetztes
# APP_SECRET hat immer Vorrang.
set -eu

SECRET_FILE="${APP_SECRET_FILE:-/app/data/app_secret}"

if [ -z "${APP_SECRET:-}" ]; then
  if [ ! -s "$SECRET_FILE" ]; then
    mkdir -p "$(dirname "$SECRET_FILE")"
    node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))' \
      > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "dokunc: kein APP_SECRET gesetzt — ein zufälliges wurde erzeugt und in $SECRET_FILE gespeichert."
    echo "dokunc: für Betrieb über mehrere Hosts/Deployments hinweg APP_SECRET selbst setzen (openssl rand -base64 48)."
  fi
  APP_SECRET="$(cat "$SECRET_FILE")"
  export APP_SECRET
fi

# Redis-Passwort (docker-compose.yml: REDIS_PASSWORD_FILE, Volume
# redis_auth). Der Dienst redis erzeugt es beim ersten Start
# (scripts/redis-start.sh); hier kommt es in REDIS_URL, damit Web, Collab
# und die Migrationen es ohne eigenen Code nutzen. Nur für den
# mitgelieferten Dienst redis und nur, wenn REDIS_URL noch keine
# Anmeldedaten trägt: eine eigene REDIS_URL aus einer override-Datei
# bleibt unberührt. Nur Zeichen, die in der URL ohne Kodierung stehen
# dürfen (ein eigenes Passwort aus --requirepass kann andere enthalten,
# dann braucht es eine eigene REDIS_URL). Ob der Hauptprozess das Passwort
# bekommen hat, prüft der Healthcheck der App in docker-compose.yml.
if [ -n "${REDIS_PASSWORD_FILE:-}" ]; then
  case "${REDIS_URL:-}" in
    redis://redis:6379|redis://redis:6379/*)
      REDIS_PW="$(cat "$REDIS_PASSWORD_FILE" 2>/dev/null || true)"
      case "$REDIS_PW" in
        '')
          echo "dokunc: Redis-Passwort fehlt ($REDIS_PASSWORD_FILE), Verbindung ohne Passwort." >&2 ;;
        *[!0-9A-Za-z._~-]*)
          echo "dokunc: Redis-Passwort in $REDIS_PASSWORD_FILE braucht in REDIS_URL eine Kodierung, Verbindung ohne Passwort (eigene REDIS_URL setzen)." >&2 ;;
        *)
          REDIS_URL="redis://:${REDIS_PW}@${REDIS_URL#redis://}"
          export REDIS_URL ;;
      esac
      unset REDIS_PW
      ;;
  esac
fi

exec "$@"
