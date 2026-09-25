#!/usr/bin/env bash
# Sichert PostgreSQL (custom dump) + den Uploads-Ordner.
# Nutzung: ./scripts/backup.sh   (Container müssen laufen)
set -euo pipefail
cd "$(dirname "$0")/.."

# Dump und Uploads-Archiv enthalten sämtliche Passwort-Hashes, die
# versiegelten TOTP-Geheimnisse und alle Seiteninhalte. Ohne diese Zeile
# erben sie die Umask der aufrufenden Sitzung (üblich 022) — auf einem
# Host mit mehreren Konten könnte jeder lokale Nutzer die Sicherung
# lesen.
umask 077

mkdir -p backups
# Ein schon bestehendes backups/ zieht die Umask nicht mehr nach.
chmod 700 backups
TS="$(date +%Y%m%d-%H%M%S)"

echo "→ Datenbank-Dump…"
docker compose exec -T db pg_dump -U dokunc -Fc dokunc > "backups/db-${TS}.dump"

echo "→ Uploads…"
docker compose cp app:/app/uploads "backups/uploads-${TS}" >/dev/null
# Ohne Unterdrueckung: scripts/restore.sh vertraut dem Archiv, ein
# Fehler hier muss die Sicherung scheitern lassen.
tar czf "backups/uploads-${TS}.tar.gz" -C "backups/uploads-${TS}" .
rm -rf "backups/uploads-${TS}"

echo "✓ Fertig:"
echo "  backups/db-${TS}.dump"
echo "  backups/uploads-${TS}.tar.gz"
echo
echo "Wiederherstellen:"
echo "  ./scripts/restore.sh ${TS}"

# Das automatisch erzeugte APP_SECRET gehoert bewusst nicht in die
# Sicherung (apps/web/src/lib/secret-box.ts): eine Sicherung allein soll nicht genuegen,
# um die Zwei-Faktor-Geheimnisse zu entsiegeln. Ist es in der .env
# gesetzt, liegt es ohnehin beim Betreiber.
if [ -z "$(docker compose exec -T app printenv APP_SECRET 2>/dev/null || true)" ]; then
  echo
  echo "Nicht enthalten: das automatisch erzeugte APP_SECRET (Volume app_data). Ohne es lassen sich"
  echo "auf einem neuen Host die Zwei-Faktor-Geheimnisse nicht mehr entsiegeln. Einmal getrennt sichern,"
  echo "ausserhalb des Repositorys und nicht neben den Sicherungen:"
  echo "  (umask 077; docker compose exec -T app cat /app/data/app_secret > ~/dokunc-app_secret)"
fi
