import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Gemeinsame Docker-Attrappe fuer die Tests von scripts/backup.sh und
 * scripts/restore.sh (restore-script.test.ts, backup-script.test.ts).
 *
 * Das gefaelschte `docker` steht vorne im PATH, schreibt jeden Aufruf
 * mit (bei psql ohne -c auch das Skript auf stdin) und antwortet je nach
 * Aufruf. Wie echtes Compose schreibt jeder `compose run` die Zeilen
 * "Container ... Creating/Created" auf stderr; `compose exec` nicht.
 *
 * Steuerung ueber die Umgebung:
 * - FAKE_LOG          Protokolldatei
 * - FAKE_UPLOADS      Ordner, den `--entrypoint tar app czf - -C /app/uploads .` packt
 * - FAKE_TAR          gut (Vorgabe) oder abgeschnitten (20 Byte, Exit 0)
 * - FAKE_TAR_EXIT     Exit von tar (vorher "Permission denied" auf stderr)
 * - FAKE_PGDUMP_EXIT  Exit von pg_dump (vorher "service db is not running")
 * - FAKE_LISTE        Ausgabe von pg_restore --list
 * - FAKE_LISTE_EXIT   Exit von pg_restore --list
 * - FAKE_DUMP_EXIT    Exit von pg_restore -f /dev/null
 * - FAKE_SECRET       Inhalt von /app/data/app_secret (cat)
 * - FAKE_SECRET_LAGE  Antwort des node-Aufrufs (env, fehlt, merkmal <hex>)
 * - FAKE_LAGE_EXIT    Exit des node-Aufrufs (vorher "Image fehlt")
 * - FAKE_START_EXIT   Exit von up -d --wait --wait-timeout 300
 * - FAKE_MIGRATIONS   Migrationen in _prisma_migrations der Zwischenablage
 * - FAKE_LOESCHEN_BEIM_EINSPIELEN  Dateien, die waehrend pg_restore in die
 *                     Zwischenablage verschwinden (Aufbewahrung eines
 *                     gleichzeitigen cron-Laufs)
 * - FAKE_PROJEKT      Projektname aus docker-compose.yml (Vorgabe dokunc);
 *                     `compose config` nimmt wie Compose zuerst
 *                     COMPOSE_PROJECT_NAME aus der Umgebung, dann aus der
 *                     .env im Arbeitsverzeichnis
 * - FAKE_CONFIG_EXIT  Exit von `compose config` (vorher eine Fehlermeldung)
 * - FAKE_VOLUMES      vorhandene Volumes mit Anlagedatum, durch Leerzeichen
 *                     getrennt: "wiki_db_data=2026-05-19T08:00:00Z …". Ein
 *                     Volume <projekt>_<name> traegt die Labels von Compose
 *                     (Projekt und Volume), wie Compose es anlegt.
 * - FAKE_DOCKER_WEG   ohne Zugriff auf den Docker-Dienst: "alle" laesst
 *                     jeden Aufruf `volume …` scheitern, "ls" nur
 *                     `volume ls`, "inspect" nur `volume inspect`, mit der
 *                     Meldung von Docker bei fehlender Berechtigung.
 *                     `compose config` braucht den Dienst nicht.
 *
 * Das Ersetzen der Uploads (`tar xzf - -C /app/uploads`) schreibt den
 * Inhalt des Archivs auf stdin als Zeile "UPLOADS <Eintraege>" mit.
 */
export const FAKE_DOCKER = `#!/usr/bin/env bash
args="$*"
if [[ "$args" == *psql* && "$args" != *" -c "* ]]; then
  printf 'ARGS %s\\nSTDIN %s\\n' "$args" "$(cat)" >> "$FAKE_LOG"
else
  printf 'ARGS %s\\n' "$args" >> "$FAKE_LOG"
fi
if [[ "$args" == "compose run "* ]]; then
  echo " Container fake-app-run-1 Creating" >&2
  echo " Container fake-app-run-1 Created" >&2
fi
case "\${FAKE_DOCKER_WEG:-}:$args" in
  alle:"volume "*|ls:"volume ls "*|inspect:"volume inspect "*)
    echo "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock" >&2
    exit 1 ;;
esac
# Volumes aus FAKE_VOLUMES: Name -> Anlagedatum
declare -A VOLUME
for v in \${FAKE_VOLUMES:-}; do VOLUME["\${v%%=*}"]="\${v#*=}"; done
case "$args" in
  "compose config"*)
    if [ "\${FAKE_CONFIG_EXIT:-0}" != 0 ]; then
      echo "env file .env: unexpected character in variable name" >&2
      exit "$FAKE_CONFIG_EXIT"
    fi
    name="\${COMPOSE_PROJECT_NAME:-}"
    if [ -z "$name" ] && [ -f .env ]; then
      name=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | tail -n 1 | tr -d "\\"'")
    fi
    printf 'name: %s\nservices:\n  app: {}\n' "\${name:-\${FAKE_PROJEKT:-dokunc}}"
    exit 0 ;;
  "volume inspect -f {{.CreatedAt}} "*)
    v="\${args##* }"
    if [ -n "\${VOLUME[$v]+x}" ]; then printf '%s\n' "\${VOLUME[$v]}"; exit 0; fi
    echo "Error response from daemon: get $v: no such volume" >&2
    exit 1 ;;
  "volume inspect "*)
    for v in \${args#volume inspect }; do
      if [ -z "\${VOLUME[$v]+x}" ]; then
        echo "Error response from daemon: get $v: no such volume" >&2
        exit 1
      fi
    done
    echo "[]"
    exit 0 ;;
  "volume ls --filter label=com.docker.compose.volume="*)
    art="\${args#volume ls --filter label=com.docker.compose.volume=}"
    art="\${art%% *}"
    for v in "\${!VOLUME[@]}"; do
      case "$v" in *_"$art") printf '%s\n' "\${v%_"$art"}" ;; esac
    done
    exit 0 ;;
  *"pg_restore -f /dev/null"*) cat >/dev/null; exit "\${FAKE_DUMP_EXIT:-0}" ;;
  *"pg_restore --list"*)
    cat >/dev/null
    printf '%s\\n' "\${FAKE_LISTE:-3439; 0 16385 TABLE DATA public _prisma_migrations dokunc}"
    exit "\${FAKE_LISTE_EXIT:-0}" ;;
  *"cat > /app/data/app_secret"*) printf 'SECRET %s\\n' "$(cat)" >> "$FAKE_LOG"; exit 0 ;;
  *"--entrypoint cat app /app/data/app_secret"*) printf '%s' "\${FAKE_SECRET:-}"; exit 0 ;;
  *"--entrypoint node app"*)
    if [ "\${FAKE_LAGE_EXIT:-0}" != 0 ]; then echo "Fehler: Image fehlt" >&2; fi
    printf '%s\\n' "\${FAKE_SECRET_LAGE:-env}"
    exit "\${FAKE_LAGE_EXIT:-0}" ;;
  *"up -d --wait --wait-timeout 300"*) exit "\${FAKE_START_EXIT:-0}" ;;
  *pg_dump*)
    if [ "\${FAKE_PGDUMP_EXIT:-0}" != 0 ]; then echo 'service "db" is not running' >&2; fi
    printf 'DUMP'
    exit "\${FAKE_PGDUMP_EXIT:-0}" ;;
  *"--entrypoint tar app czf - -C /app/uploads ."*)
    if [ "\${FAKE_TAR_EXIT:-0}" != 0 ]; then echo "tar: ./x: Cannot open: Permission denied" >&2; fi
    if [ "\${FAKE_TAR:-gut}" = abgeschnitten ]; then
      tar czf - -C "$FAKE_UPLOADS" . | head -c 20
    else
      tar czf - -C "$FAKE_UPLOADS" .
    fi
    exit "\${FAKE_TAR_EXIT:-0}" ;;
  *_prisma_migrations*) printf '%s\\n' $FAKE_MIGRATIONS; exit 0 ;;
  *"pg_restore -U dokunc -d dokunc_restore"*)
    cat >/dev/null
    if [ -n "\${FAKE_LOESCHEN_BEIM_EINSPIELEN:-}" ]; then rm -f $FAKE_LOESCHEN_BEIM_EINSPIELEN; fi
    exit 0 ;;
  *"tar xzf - -C /app/uploads"*)
    printf 'UPLOADS %s\\n' "$(tar tzf - 2>&1 | sort | tr '\\n' ' ')" >> "$FAKE_LOG"
    exit 0 ;;
esac
exit 0
`;

export const BEKANNTE_MIGRATION = "20260519132107_init";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Baut unter `dir` den Teil des Repositorys nach, den die Skripte
 * brauchen: scripts/ (Kopien von backup.sh, restore.sh und
 * projektname.sh), backups/,
 * bin/docker (Attrappe), uploads-quelle/ (Inhalt des Upload-Volumes) und
 * packages/db/prisma/migrations mit einer bekannten Migration.
 */
export function legeSkriptbaumAn(dir: string): void {
  for (const ordner of ["scripts", "backups", "bin", "uploads-quelle"]) {
    mkdirSync(join(dir, ordner), { recursive: true });
  }
  writeFileSync(join(dir, "uploads-quelle/bild.png"), "x");
  mkdirSync(join(dir, "packages/db/prisma/migrations", BEKANNTE_MIGRATION), {
    recursive: true,
  });
  writeFileSync(
    join(dir, "packages/db/prisma/migrations/migration_lock.toml"),
    'provider = "postgresql"\n',
  );
  for (const name of ["restore.sh", "backup.sh", "projektname.sh"]) {
    copyFileSync(join(ROOT, "scripts", name), join(dir, "scripts", name));
    chmodSync(join(dir, "scripts", name), 0o755);
  }
  writeFileSync(join(dir, "bin/docker"), FAKE_DOCKER);
  chmodSync(join(dir, "bin/docker"), 0o755);
}

/**
 * Umgebung fuer einen Skriptlauf: ohne BACKUP_KEEP_DAYS der aufrufenden
 * Umgebung (ein Wert auf der Entwicklermaschine darf keinen Test
 * verfaelschen), Attrappe vorne im PATH, Zeit in UTC.
 */
export function skriptUmgebung(
  dir: string,
  log: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.BACKUP_KEEP_DAYS;
  return {
    ...env,
    PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
    FAKE_LOG: log,
    FAKE_UPLOADS: join(dir, "uploads-quelle"),
    TZ: "UTC",
    ...extra,
  };
}

/**
 * Legt bin/date an: mit gesetztem FAKE_TS gibt `date +%Y%m%d-%H%M%S`
 * genau FAKE_TS aus, alles andere geht an das echte date.
 */
export function falschesDatum(dir: string): void {
  const datei = join(dir, "bin/date");
  writeFileSync(
    datei,
    `#!/usr/bin/env bash
if [ -n "\${FAKE_TS:-}" ] && [ "$#" -eq 1 ] && [ "$1" = "+%Y%m%d-%H%M%S" ]; then
  printf '%s\\n' "$FAKE_TS"
  exit 0
fi
exec "$(PATH="\${PATH#*:}" command -v date)" "$@"
`,
  );
  chmodSync(datei, 0o755);
}

/** Uploads-Archiv mit einer Datei, wie backup.sh es anlegt. */
export function uploadsArchiv(ziel: string, quelle: string): void {
  const r = spawnSync("tar", ["czf", ziel, "-C", quelle, "."]);
  if (r.status !== 0) throw new Error(`tar czf ${ziel}: ${r.stderr}`);
}
