#!/usr/bin/env bash
# Sichert PostgreSQL (custom dump) + den Uploads-Ordner.
# Nutzung: ./scripts/backup.sh   (Container müssen laufen)
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
TS="$(date +%Y%m%d-%H%M%S)"

echo "→ Datenbank-Dump…"
docker compose exec -T db pg_dump -U dokunc -Fc dokunc > "backups/db-${TS}.dump"

echo "→ Uploads…"
docker compose cp app:/app/uploads "backups/uploads-${TS}" >/dev/null
tar czf "backups/uploads-${TS}.tar.gz" -C "backups/uploads-${TS}" . 2>/dev/null || true
rm -rf "backups/uploads-${TS}"

echo "✓ Fertig:"
echo "  backups/db-${TS}.dump"
echo "  backups/uploads-${TS}.tar.gz"
echo
echo "Wiederherstellen:"
echo "  cat backups/db-${TS}.dump | docker compose exec -T db pg_restore -U dokunc -d dokunc --clean --if-exists"
echo "  (Uploads: Archiv nach /app/uploads im app-Container/Volume entpacken)"
