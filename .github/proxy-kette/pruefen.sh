#!/usr/bin/env bash
# Kettentest: Client-Adressen hinter einem vorgelagerten Proxy.
#
#   Sonde (feste Adresse) -> vorproxy -> proxy (mitgelieferter Caddy) -> app
#
# Aufgerufen vom CI-Job docker (Schritt "Proxy-Kette"), wenn der Stack mit
# docker-compose.yml und .github/proxy-kette/compose.yml laeuft. Jede
# Sonde ist ein eigener Container mit fester Adresse im Netz der Kette
# (Adressen in compose.yml).
#
# Umgebung:
#   NETZ  Docker-Netz der Kette (<projekt>_kette)
#   BILD  Image mit Node fuer die Sonden (im CI das App-Image)
#   SQL   optional: Befehl, dem die Abfrage als letztes Argument folgt
#         (Vorgabe: psql im Dienst db)
#   LOGS  optional: Befehl, der das Log der App ausgibt
#         (Vorgabe: docker compose logs app)
#   REDIS optional: Befehl, dem ein redis-cli-Befehl folgt
#         (Vorgabe: redis-cli im Dienst redis, mit dessen Passwort)
set -euo pipefail

HIER=$(cd "$(dirname "$0")" && pwd)
A=198.18.250.11 # Sonde A
B=198.18.250.12 # Sonde B
C=198.18.250.13 # in RATE_LIMIT_EXEMPT_NETWORKS
F=198.18.250.14 # faelscht X-Forwarded-For
D=198.18.250.15 # geht am vorgelagerten Proxy vorbei
E=198.18.250.16 # faelscht die ausgenommene Adresse

# sonde <adresse> [--direkt] <befehl> ...
sonde() {
  local ip=$1 ziel=http://vorproxy
  shift
  if [ "$1" = --direkt ]; then
    ziel=https://proxy:443
    shift
  fi
  docker run --rm --network "$NETZ" --ip "$ip" -e SONDE_ZIEL="$ziel" \
    -v "$HIER:/sonde:ro" --entrypoint node "$BILD" /sonde/sonde.mjs "$@"
}

sql() {
  if [ -n "${SQL:-}" ]; then
    $SQL "$1"
  else
    docker compose exec -T db psql -X -U dokunc -d dokunc -v ON_ERROR_STOP=1 -At -c "$1"
  fi
}

redis_cmd() {
  if [ -n "${REDIS:-}" ]; then
    $REDIS "$@"
  else
    docker compose exec -T redis sh -c 'REDISCLI_AUTH="$(cat /run/redis-auth/password)" redis-cli "$@"' redis-cli "$@"
  fi
}

app_log() {
  if [ -n "${LOGS:-}" ]; then $LOGS; else docker compose logs --no-color app; fi
}

# Adressen im Audit-Log zu den Anmeldungen mit diesem E-Mail-Praefix.
audit_ips() {
  sql "SELECT coalesce(string_agg(DISTINCT coalesce(ip, 'null'), ' '), '') FROM \"AuditLog\" WHERE action = 'auth.login_failed' AND metadata->>'email' LIKE '$1-%'"
}

# erwarte <was> <erwartet> <erhalten>
erwarte() {
  if [ "$2" != "$3" ]; then
    echo "FEHLER $1: erwartet [$2], erhalten [$3]"
    exit 1
  fi
  echo "ok $1: $3"
}

# n-mal dasselbe Wort, durch Leerzeichen getrennt
mal() {
  local aus=""
  for _ in $(seq 1 "$1"); do aus="$aus $2"; done
  echo "${aus# }"
}

# Bis die Kette durchreicht: Caddy stellt nach einem Neustart erst sein
# Zertifikat aus. Die Aufwaermanmeldung zaehlt nur fuer ihre eigene Adresse.
bereit() {
  for _ in $(seq 1 30); do
    if [ "$(sonde 198.18.250.20 login-falsch kette-warm 1 2>/dev/null || true)" = falsch ]; then
      return 0
    fi
    sleep 2
  done
  echo "FEHLER: die Kette reicht nach 60 s keine Anmeldung durch"
  exit 1
}

# Teil A: verschiedene Client-Adressen in Bremse, Audit und Collab-Grenze.
# Aufruf: pruefen.sh a b ... (Vorgabe: a)
teil_a() {
  # Ein vom Client gefaelschter Anfang zaehlt nicht. Vor der Serie von A
  # und von einer eigenen Adresse: ist eine Adresse gebremst, entsteht
  # kein Audit-Eintrag mehr.
  erwarte "Faelschung angenommen" falsch "$(sonde "$F" login-falsch kette-f 1 "$B")"
  erwarte "Audit nimmt die echte Adresse der Faelschung" "$F" "$(audit_ips kette-f)"

  # Bremse je Adresse (Vorgabe 30 Anmeldungen in 5 Minuten): A wird
  # gebremst, B nicht.
  erwarte "Bremse fuer A" "$(mal 30 falsch) gebremst" "$(sonde "$A" login-falsch kette-a 31)"
  erwarte "B nicht gebremst" falsch "$(sonde "$B" login-falsch kette-b 1)"
  erwarte "Audit A" "$A" "$(audit_ips kette-a)"
  erwarte "Audit B" "$B" "$(audit_ips kette-b)"

  # Collab-Versuche je Adresse (COLLAB_MAX_ATTEMPTS_PER_IP=3 in compose.yml).
  erwarte "Collab A" "101 101 101 429" "$(sonde "$A" collab-upgrade 4)"
  erwarte "Collab B" "101" "$(sonde "$B" collab-upgrade 1)"

  # Am vorgelagerten Proxy vorbei: Caddy ersetzt den Header durch die
  # Gegenstelle, er ist dann kuerzer als TRUSTED_PROXY_HOPS, und die App
  # meldet das.
  erwarte "Direkt an Caddy" falsch "$(sonde "$D" --direkt login-falsch kette-d 1)"
  erwarte "Audit ohne Adresse" null "$(audit_ips kette-d)"
  if ! app_log | grep -q '"reason":"header_too_short"'; then
    echo "FEHLER: die Warnung header_too_short fehlt im Log der App"
    exit 1
  fi
  echo "ok Warnung header_too_short im Log der App"
}

# Teil B: die Bremse je Adresse ist per Umgebung einstellbar
# (RATE_LIMIT_SSO_START_PER_IP=3/10m in compose.yml) und zaehlt je Adresse.
teil_b() {
  erwarte "SSO-Start A" "error error error throttled" "$(sonde "$A" sso-start 4)"
  erwarte "SSO-Start B" "error" "$(sonde "$B" sso-start 1)"
}

# Teil C: eine ausgenommene Adresse (RATE_LIMIT_EXEMPT_NETWORKS in
# compose.yml) wird hinter dem vorgelagerten Proxy weder in der App noch
# im Collab-Server je Adresse gebremst; eine gefaelschte ausgenommene
# Adresse im Header nimmt niemanden aus.
teil_c() {
  erwarte "SSO-Start ausgenommen" "$(mal 6 error)" "$(sonde "$C" sso-start 6)"
  erwarte "Collab ausgenommen" "$(mal 5 101)" "$(sonde "$C" collab-upgrade 5)"
  erwarte "Faelschung der Ausnahme" "error error error throttled" "$(sonde "$E" sso-start 4 "$C")"
  local schluessel
  schluessel=$(redis_cmd --scan --pattern "dokunc:rl:*$C*")
  erwarte "Keine Zaehler fuer die ausgenommene Adresse" "" "$schluessel"
}

bereit
for teil in "${@:-a}"; do
  "teil_$teil"
done
