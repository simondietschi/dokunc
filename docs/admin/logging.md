# Logging

This page covers the log output of a Docker installation: what the lines
look like, how to read them, how Docker rotates them, and how to send them
to a central log system.

## Log format

The web app and the collaboration server write one JSON object per line
([pino](https://getpino.io/)). Every line has:

- `level`: a number, 10 trace, 20 debug, 30 info, 40 warn, 50 error,
  60 fatal. `LOG_LEVEL` in `.env` sets the lowest level that is written
  (default `info`).
- `time`: milliseconds since 1970-01-01 UTC.
- `app`: `dokunc-web` or `dokunc-collab`.
- `msg`: the message, in German.
- `err`: for errors, an object with `type`, `message` and `stack`, plus
  fields such as `code` where the error has them.

Password fields, the `Authorization` header and the arguments of Redis
commands are replaced by `[Redacted]`. Errors of invitation, password
reset and notification mails are logged without the recipient's address.

In the `app` container, the start command runs both servers through
`concurrently`, which puts `[web] ` or `[collab] ` in front of each of
their lines. A few lines are plain text: the container's entrypoint, the
database migrations and the start banner of Next.js.

## Reading logs

Follow the output of the app:

    docker compose logs -f app

Only errors and worse, as JSON (the `sed` removes the prefix, `fromjson?`
skips the plain-text lines):

    docker compose logs --no-log-prefix app | sed -E 's/^\[(web|collab)\] //' | jq -cR 'fromjson? | select(.level >= 50)'

The other services (`proxy`, `db`, `redis`, `gotenberg`) write in their
own formats.

## Rotation

Docker stores the output of every container in files on the host
(`json-file` log driver). `docker-compose.yml` limits them for every
service of the stack: at most `LOG_MAX_FILE` files of `LOG_MAX_SIZE` each
per container. When the current file is full, Docker starts a new one and
deletes the oldest.

| Setting | Default | Meaning |
|---|---|---|
| `LOG_MAX_SIZE` | `10m` | Size of one file; units `k`, `m` or `g` |
| `LOG_MAX_FILE` | `5` | Number of files per container, at least 1 |

With the defaults, the five containers use at most about 250 MB of disk
for logs. `docker compose logs` shows only what is still in these files.

Set the values in `.env`, then run `docker compose up -d`: Docker applies
them when it creates a container, so Compose re-creates the containers.
Docker deletes the logs of a container when it re-creates it; save what
you still need first, for example:

    docker compose logs --no-log-prefix app > app-log-before-change.txt

An invalid value (for example `LOG_MAX_SIZE=ten`) stops Docker from
creating the container, with the message `invalid size`.

## Central collection

There are two ways to get the logs into a central system (Loki, ELK,
Graylog, a SIEM):

- **Read the files.** Collectors such as Promtail, Vector or Fluent Bit
  read the `json-file` logs of all containers from
  `/var/lib/docker/containers/*/*-json.log` and follow the rotation. The
  settings above then only size the local buffer.
- **Use another log driver.** A log driver set in
  `/etc/docker/daemon.json` does not apply to this stack, because
  `docker-compose.yml` sets the driver for each service. Set it in a
  `docker-compose.override.yml` next to `docker-compose.yml` instead,
  for each service you want to send, for example:

      services:
        app:
          logging:
            driver: journald

  If `COMPOSE_FILE` is set (as in the domain setup of the README),
  Docker Compose does not read `docker-compose.override.yml` by itself;
  append it to the list, for example
  `COMPOSE_FILE=docker-compose.yml:docker-compose.domain.yml:docker-compose.override.yml`.
  With a different driver, Compose drops the `json-file` options
  (`max-size`, `max-file`) for that service; with `driver: json-file`,
  the options you set are merged with the defaults. Check afterwards
  that `docker compose config` shows the new driver for the service,
  that `docker compose logs` still shows the output, and that your
  system rotates or limits the logs itself.

## Startup configuration check

At startup, the web app and the collaboration server check their
configuration. On success, each writes one line "Konfiguration geprueft"
at level 30 with the checked settings (secrets masked) in `config` and
the names of the other settings that are set in `unchecked`. Warnings
about a setting are lines at level 40 with the field `variable`.

When a checked setting is invalid, the server writes one line at level 60
with every problem in `errors` (each with `variable` and `message`) and
stops with exit code 78. Fix the setting named there and start again.
