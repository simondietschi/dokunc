#!/usr/bin/env bash
# Spielt eine Sicherung aus scripts/backup.sh zurueck: Datenbank und Uploads.
# Nutzung: ./scripts/restore.sh [--ja] [--ohne-vorsicherung] [--secret DATEI] <ZEITSTEMPEL>
#   ZEITSTEMPEL wie in backups/db-<ZEITSTEMPEL>.dump, z. B. 20260925-143000.
#   --ja                 ohne Rueckfrage (Skripte, CI)
#   --ohne-vorsicherung  den aktuellen Stand vorher nicht sichern
#   --secret DATEI       getrennt gesichertes APP_SECRET ins Volume app_data legen
#
# Ablauf (README "Sicherung und Rückweg"): Dateien pruefen, Rueckfrage,
# Vorsicherung, Dump in eine frische Datenbank einspielen und deren
# Migrationen pruefen (die App laeuft dabei noch), App anhalten, die
# frische Datenbank atomar gegen die bisherige tauschen (die bisherige
# bleibt als dokunc_vor_<Datum>_<Zeit> liegen), Uploads ersetzen,
# optional APP_SECRET zuruecklegen, Migrationen nachsetzen, neue
# Restore-Epoche, Sitzungen beenden, offene Mails erledigen, App starten.
#
# Warum nicht pg_restore --clean in die laufende Datenbank: --clean
# loescht nur, was im Dump steht. Tabellen spaeterer Migrationen blieben
# stehen, waehrend _prisma_migrations zurueckfaellt, und der naechste
# migrate deploy braeche mit "relation already exists" ab.
set -Eeuo pipefail
# Relative Pfade in den Argumenten (--secret) gelten vom Aufrufort aus.
AUFRUFORT=$PWD
cd "$(dirname "$0")/.."
umask 077

nutzung() {
  echo "Nutzung: ./scripts/restore.sh [--ja] [--ohne-vorsicherung] [--secret DATEI] <ZEITSTEMPEL>" >&2
  echo "  ZEITSTEMPEL wie in backups/db-<ZEITSTEMPEL>.dump, z. B. 20260925-143000" >&2
}

JA=0
VORSICHERUNG=1
SECRET_DATEI=""
TS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ja) JA=1 ;;
    --ohne-vorsicherung) VORSICHERUNG=0 ;;
    --secret)
      if [ $# -lt 2 ]; then nutzung; exit 2; fi
      SECRET_DATEI="$2"
      shift
      ;;
    -h|--help) nutzung; exit 0 ;;
    -*) echo "Unbekannte Option: $1" >&2; nutzung; exit 2 ;;
    *)
      if [ -n "$TS" ]; then nutzung; exit 2; fi
      TS="$1"
      ;;
  esac
  shift
done
if [ -z "$TS" ]; then nutzung; exit 2; fi
if [ -n "$SECRET_DATEI" ] && [[ "$SECRET_DATEI" != /* ]]; then
  SECRET_DATEI="$AUFRUFORT/$SECRET_DATEI"
fi
# Nur der Zeitstempel, kein Pfad: die Dateien liegen immer in backups/.
if ! [[ "$TS" =~ ^[0-9]{8}-[0-9]{6}$ ]]; then
  echo "Ungültiger Zeitstempel: $TS (erwartet JJJJMMTT-HHMMSS)" >&2
  nutzung
  exit 2
fi

DUMP="backups/db-${TS}.dump"
UPLOADS="backups/uploads-${TS}.tar.gz"
PSQL=(docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U dokunc)

SCHRITT="Start"
PHASE="unveraendert"
VOR_DB=""
VTS=""

fehler() {
  # In einer Befehlsersetzung erbt die Subshell die Falle (set -E); dort
  # nur beenden, die Meldung kommt einmal aus der aufrufenden Shell.
  if [ "${BASH_SUBSHELL:-0}" -gt 0 ]; then exit 1; fi
  trap - ERR
  set +e
  # Die eigene Zwischenablage aufraeumen (nach dem Tausch gibt es sie
  # nicht mehr). Best effort: ist die Datenbank nicht erreichbar, bleibt
  # sie liegen und wird beim naechsten Lauf ersetzt.
  "${PSQL[@]}" -d postgres -q -o /dev/null \
    -c 'DROP DATABASE IF EXISTS dokunc_restore WITH (FORCE)' </dev/null >/dev/null 2>&1
  echo >&2
  echo "✗ Abgebrochen bei: $SCHRITT." >&2
  case "$PHASE" in
    unveraendert)
      echo "Datenbank und App unverändert." >&2
      ;;
    angehalten)
      echo "Datenbank unverändert. App wieder starten: docker compose up -d" >&2
      ;;
    getauscht)
      echo "Die Datenbank enthält schon den Stand vom $TS, der vorherige liegt in $VOR_DB." >&2
      if [ -n "$VTS" ]; then
        echo "Das Skript erneut ausführen (legt eine weitere Kopie an; mit --ohne-vorsicherung, die Vorsicherung liegt schon in backups/) oder den vorherigen Stand zurückholen: ./scripts/restore.sh $VTS." >&2
      else
        echo "Das Skript erneut ausführen (legt eine weitere Kopie an) oder den vorherigen Stand aus der Datenbank $VOR_DB zurückholen (nur die Datenbank: die bisherigen Uploads sind nicht gesichert)." >&2
      fi
      echo "Die App bleibt angehalten." >&2
      ;;
    fertig)
      # Nur noch der Start fehlt: nicht erneut zurueckspielen, und schon
      # gar nicht den vorherigen Stand holen.
      echo "Der Stand vom $TS ist vollständig zurückgespielt, nur die App wurde nicht rechtzeitig bereit." >&2
      echo "Zustand prüfen mit docker compose ps und docker compose logs app, starten mit docker compose up -d. Erneut zurückspielen ist nicht nötig." >&2
      ;;
  esac
  exit 1
}
trap 'fehler' ERR

# 2. Dateien pruefen, bevor irgendetwas angehalten wird.
SCHRITT="Dateien prüfen"
if [ ! -s "$DUMP" ]; then
  echo "$DUMP fehlt oder ist leer." >&2
  exit 1
fi
if [ ! -s "$UPLOADS" ]; then
  echo "$UPLOADS fehlt oder ist leer." >&2
  exit 1
fi
if ! tar tzf "$UPLOADS" >/dev/null 2>&1; then
  echo "Uploads-Archiv beschädigt: $UPLOADS" >&2
  exit 1
fi
if [ -n "$SECRET_DATEI" ]; then
  if [ ! -f "$SECRET_DATEI" ]; then
    echo "Secret-Datei fehlt: $SECRET_DATEI" >&2
    exit 1
  fi
  if [ "$(tr -d '\n' < "$SECRET_DATEI" | wc -c)" -lt 32 ]; then
    echo "Secret-Datei zu kurz (mindestens 32 Zeichen): $SECRET_DATEI" >&2
    exit 1
  fi
fi

echo "→ Datenbank starten…"
docker compose up -d --wait db redis
echo "→ Dump prüfen…"
# Liest den ganzen Dump: ein abgeschnittener faellt hier auf, nicht erst
# nach dem Anhalten.
if ! docker compose exec -T db pg_restore -f /dev/null < "$DUMP"; then
  echo "Dump beschädigt oder unlesbar: $DUMP" >&2
  exit 1
fi

# 3. Rueckfrage
if [ "$JA" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "Kein Terminal für die Rückfrage. Zum Fortfahren ohne Rückfrage --ja angeben." >&2
    exit 1
  fi
  if [ "$VORSICHERUNG" -eq 1 ]; then
    ZUSATZ=" (vorher wird der aktuelle Stand gesichert)"
  else
    ZUSATZ=" (ohne Vorsicherung: die bisherige Datenbank bleibt als Kopie liegen, die bisherigen Uploads nicht)"
  fi
  echo "Das ersetzt Datenbank und Uploads durch den Stand vom ${TS}. Was seither geändert wurde, geht verloren${ZUSATZ}. Alle werden abgemeldet."
  read -r -p "Zum Fortfahren ja eingeben: " ANTWORT
  if [ "$ANTWORT" != "ja" ]; then
    echo "Abgebrochen, nichts verändert." >&2
    exit 1
  fi
fi

# 4. Vorsicherung
if [ "$VORSICHERUNG" -eq 1 ]; then
  SCHRITT="Vorsicherung"
  # Gleicher Zeitstempel hiesse: die Vorsicherung ueberschriebe die
  # Sicherung, die gleich zurueckgespielt wird.
  if [ "$(date +%Y%m%d-%H%M%S)" = "$TS" ]; then sleep 1; fi
  echo "→ Vorsicherung des aktuellen Stands…"
  if ! AUSGABE=$(./scripts/backup.sh); then
    echo "Vorsicherung gescheitert, nichts verändert. Mit --ohne-vorsicherung überspringen." >&2
    exit 1
  fi
  printf '%s\n' "$AUSGABE"
  VTS=$(printf '%s\n' "$AUSGABE" | sed -n 's#.*backups/db-\([0-9]\{8\}-[0-9]\{6\}\)\.dump$#\1#p' | head -n 1)
  if [ -z "$VTS" ]; then
    echo "Vorsicherung gescheitert, nichts verändert. Mit --ohne-vorsicherung überspringen." >&2
    exit 1
  fi
fi

# 5. Dump in eine frische Datenbank, waehrend die App noch laeuft.
# dokunc_restore ist die eigene Zwischenablage des Skripts; nur sie wird
# hier geloescht.
SCHRITT="Dump in frische Datenbank einspielen"
echo "→ Dump in eine frische Datenbank einspielen…"
"${PSQL[@]}" -d postgres -q -o /dev/null \
  -c 'SET client_min_messages = warning' \
  -c 'DROP DATABASE IF EXISTS dokunc_restore WITH (FORCE)' \
  -c 'CREATE DATABASE dokunc_restore OWNER dokunc TEMPLATE template0' </dev/null
docker compose exec -T db pg_restore -U dokunc -d dokunc_restore \
  --single-transaction --exit-on-error < "$DUMP"

# 6. Migrationen der Sicherung pruefen: kennt dieser Code-Stand eine
# davon nicht, startete er auf einem neueren Schema.
SCHRITT="Migrationen der Sicherung prüfen"
IM_DUMP=$("${PSQL[@]}" -d dokunc_restore -At -c \
  'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1' </dev/null)
BEKANNT=$(ls packages/db/prisma/migrations | grep -E '^[0-9]{14}_' | sort || true)
UNBEKANNT=$(comm -13 <(printf '%s\n' "$BEKANNT") <(printf '%s\n' "$IM_DUMP" | sort) | sed '/^$/d' || true)
if [ -n "$UNBEKANNT" ]; then
  "${PSQL[@]}" -d postgres -q -o /dev/null \
    -c 'DROP DATABASE IF EXISTS dokunc_restore WITH (FORCE)' </dev/null || true
  echo "Die Sicherung enthält Migrationen, die dieser Code-Stand nicht kennt: $(printf '%s' "$UNBEKANNT" | tr '\n' ' ' | sed 's/ $//'). Erst den passenden Stand auschecken und bauen (README „Update und Rückweg“). Nichts verändert." >&2
  exit 1
fi
VOR_DB="dokunc_vor_$(date +%Y%m%d_%H%M%S)"
VORHANDEN=$("${PSQL[@]}" -d postgres -At -v name="$VOR_DB" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'name';
SQL
)
if [ -n "$VORHANDEN" ]; then
  "${PSQL[@]}" -d postgres -q -o /dev/null \
    -c 'DROP DATABASE IF EXISTS dokunc_restore WITH (FORCE)' </dev/null || true
  echo "Die Datenbank $VOR_DB gibt es schon. In einer Sekunde erneut ausführen. Nichts verändert." >&2
  exit 1
fi

# 7. App anhalten. Der Collab-Server speichert dabei noch; das ersetzt
# der naechste Schritt. Der Proxy antwortet so lange mit 502.
SCHRITT="App anhalten"
echo "→ App anhalten…"
PHASE="angehalten"
docker compose stop app

# 8. Tausch in einer Transaktion: scheitert das zweite Umbenennen, rollt
# das erste zurueck. Kein vorhandener Stand wird geloescht.
SCHRITT="Datenbanken tauschen"
echo "→ Datenbanken tauschen (bisherige bleibt als $VOR_DB)…"
"${PSQL[@]}" -d postgres -q -1 -v vor="$VOR_DB" <<'SQL'
\o /dev/null
SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity
 WHERE datname = 'dokunc' AND pid <> pg_backend_pid();
\o
ALTER DATABASE dokunc RENAME TO :"vor";
ALTER DATABASE dokunc_restore RENAME TO dokunc;
SQL
PHASE="getauscht"

# 9. Uploads ersetzen. --entrypoint sh umgeht docker-entrypoint.sh, das
# sonst ein Secret erzeugen koennte; laeuft als node.
SCHRITT="Uploads ersetzen"
echo "→ Uploads ersetzen…"
docker compose run --rm --no-deps -T --entrypoint sh app \
  -c 'set -e; find /app/uploads -mindepth 1 -delete; tar xzf - -C /app/uploads' < "$UPLOADS"

# 10. APP_SECRET
SCHRITT="APP_SECRET"
ENV_SECRET=$(docker compose run --rm --no-deps -T --entrypoint printenv app APP_SECRET </dev/null 2>/dev/null || true)
if [ -n "$SECRET_DATEI" ]; then
  echo "→ APP_SECRET ins Volume app_data legen…"
  docker compose run --rm --no-deps -T --entrypoint sh app \
    -c 'umask 077; cat > /app/data/app_secret' < "$SECRET_DATEI"
  if [ -n "$ENV_SECRET" ]; then
    echo "Warnung: APP_SECRET ist in der .env gesetzt und hat Vorrang; die Datei im Volume wirkt erst, wenn es dort entfernt wird." >&2
  fi
elif [ -z "$ENV_SECRET" ]; then
  echo "Hinweis: APP_SECRET ist nicht gesetzt, die App nimmt das Secret aus dem Volume app_data. restore.sh lässt es unverändert. Stammt die Sicherung von einem anderen Host oder wurde das Volume neu angelegt, passt es nicht zu den Zwei-Faktor-Geheimnissen der Sicherung: dann das getrennt gesicherte Secret mit --secret DATEI zurücklegen."
fi

# 11. Migrationen nachsetzen (mit Entrypoint, wie der CMD). Legt bei einer
# Sicherung von vor der Restore-Epoche InstanceState an.
SCHRITT="Migrationen nachsetzen"
echo "→ Migrationen nachsetzen…"
docker compose run --rm --no-deps -T app pnpm --filter @dokunc/db migrate:deploy </dev/null

# 12. Epoche, Sitzungen, Mails in einer Transaktion. Die Epoche erst hier:
# die App ist noch angehalten, und der Wert aus dem Dump gilt nicht mehr.
# Sitzungen: sonst gaelten Abmeldungen und Sperren seit der Sicherung
# wieder. Mails: sonst gingen Mails, die nach der Sicherung schon
# verschickt wurden, ein zweites Mal hinaus.
SCHRITT="Restore-Epoche, Sitzungen und Mails"
EPOCHE=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
echo "→ Neue Restore-Epoche, Sitzungen beenden, offene Mails erledigen…"
"${PSQL[@]}" -d dokunc -q -1 -v epoche="$EPOCHE" <<'SQL'
SELECT to_regclass('public."InstanceState"') IS NOT NULL AS hat_epoche \gset
\if :hat_epoche
INSERT INTO "InstanceState" ("id", "restoreEpoch", "restoredAt")
  VALUES (1, :'epoche', now())
  ON CONFLICT ("id") DO UPDATE
    SET "restoreEpoch" = EXCLUDED."restoreEpoch", "restoredAt" = EXCLUDED."restoredAt";
\else
\echo 'Warnung: Dieser Code-Stand kennt keine Restore-Epoche. Kopien im Browser können spätere Änderungen zurückbringen; alle sollen ihre Tabs schliessen und die Browserdaten der Seite löschen.'
\endif
UPDATE "Session" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;
UPDATE "Notification" SET "emailedAt" = now() WHERE "emailedAt" IS NULL;
SQL
PHASE="fertig"

# 13. Start
SCHRITT="App starten"
echo "→ App starten…"
docker compose up -d --wait --wait-timeout 300

# 14. Abschluss
SCHRITT="Abschluss"
FRUEHERE=$("${PSQL[@]}" -d postgres -At -c \
  "SELECT datname FROM pg_database WHERE datname LIKE 'dokunc\_vor\_%' ORDER BY 1" </dev/null || true)
echo
echo "✓ Zurückgespielt: Stand vom ${TS}. Alle Sitzungen sind beendet. Offene Tabs bitten um Neuladen."
echo "  Restore-Epoche: ${EPOCHE}"
if [ -n "$VTS" ]; then
  echo "  Vorheriger Stand: backups/db-${VTS}.dump mit den Uploads dazu, zurückholen mit ./scripts/restore.sh ${VTS}."
  echo "  Die Datenbank ${VOR_DB} enthält zusätzlich Änderungen bis zum Anhalten, aber nicht deren Uploads."
else
  echo "  Vorheriger Stand: die Datenbank ${VOR_DB} (ohne Vorsicherung, ohne die bisherigen Uploads)."
fi
if [ -n "$FRUEHERE" ]; then
  echo "  Frühere Stände in der Datenbank (löschen mit docker compose exec db dropdb -U dokunc <name>):"
  for name in $FRUEHERE; do
    echo "    docker compose exec db dropdb -U dokunc ${name}"
  done
fi
echo "  Alle müssen sich neu anmelden."
