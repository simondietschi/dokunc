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

exec "$@"
