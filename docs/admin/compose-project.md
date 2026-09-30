# Compose project name

Docker Compose groups the containers, networks and volumes of the stack
under a project name. The volumes that hold your data are named after it:
`<project>_db_data` (database), `<project>_app_data` (secret, setup
token), `<project>_uploads`, `<project>_redis_data` and the two Caddy
volumes.

## What the project name is

`docker-compose.yml` sets `name: dokunc`, so the volumes are
`dokunc_db_data`, `dokunc_app_data` and so on, whatever the directory of
the checkout is called. Docker Compose takes the name from, in this order:

1. `COMPOSE_PROJECT_NAME` in the environment of the `docker compose`
   command,
2. `COMPOSE_PROJECT_NAME` in the `.env` next to `docker-compose.yml`,
3. `name:` in `docker-compose.yml`.

An empty value counts as not set. Show the name and check the data with:

    ./scripts/projektname.sh

It prints the project, whether its data volumes exist and which other
dokunc projects (projects with both a `db_data` and an `app_data` volume)
exist on this host.

## Installations from before the fixed name

Before the fixed name, the project was named after the directory of the
checkout: lower case, with every character other than `a-z`, `0-9`, `_`
and `-` removed (`/srv/Wiki Alt` became `wikialt`). If your checkout is in
a directory called `dokunc`, the name stays the same and there is nothing
to do.

Otherwise, run this once after `git pull` and before `docker compose up`:

    ./scripts/projektname.sh --festschreiben

It writes the previous name to `.env` (`COMPOSE_PROJECT_NAME=...`, with a
comment line), if the volumes of that name exist; otherwise it writes the
current name. It adds a line break first if the last line of `.env` has
none, keeps the file's permissions, and changes nothing if the name is
already set in `.env` or in the environment. If the previous name is not
the directory name (for example because you moved the checkout), give it
explicitly; the script accepts only a name whose volumes exist:

    ./scripts/projektname.sh --festschreiben wiki

`./scripts/projektname.sh` without options detects a missed step:

- **Exit code 1:** the project has no data volumes, but another dokunc
  project on this host has. This is the state after `git pull` and before
  the first start. Run `--festschreiben`.
- **Exit code 2:** the project has data volumes, but the update was
  probably started without `--festschreiben`. There are two cases:
  - Another dokunc project has older volumes. Docker Compose created a
    new, empty instance with a new secret next to your data. Your data
    is untouched in the old volumes; see the way back below.
  - The project named after the directory has data, and the `dokunc`
    project has data that is not younger. The `dokunc` project probably
    belongs to another installation on this host, for example one in a
    directory named `dokunc`. `docker compose up` here takes over that
    installation's containers and database: it re-creates them from this
    checkout's code and `.env` and runs this version's migrations against
    that database. Run `--festschreiben` here; it writes the directory's
    name. If `docker compose up` already ran, run `docker compose up -d`
    here and then in the other installation's directory. Do not run
    `docker compose -p dokunc down`: it stops the other installation. If
    `dokunc` is in fact the right project for this checkout, pin it with
    `./scripts/projektname.sh --festschreiben dokunc`.

  The script reports neither case when `COMPOSE_PROJECT_NAME` sets the
  name explicitly.
- **Exit code 3:** the script could not ask Docker about the volumes, for
  example because your user may not use the Docker socket. Run it the way
  you run `docker compose` (with `sudo` if you use that). `--festschreiben`
  also stops with exit code 3 and changes nothing.

The way back after a missed step that started a new, empty instance:

    docker compose -p dokunc down
    ./scripts/projektname.sh --festschreiben
    docker compose up -d

`down` without `-v` only removes the containers of the new project; no
volume is deleted. If the containers of the old project were still
running, the new stack could not start its proxy ("port is already
allocated"), and the old instance kept serving; the last command updates
it. Once you have checked that your data is back, you may remove the
empty volumes of the new project
(`docker volume ls --filter label=com.docker.compose.project=dokunc`
lists them).

As long as the new, empty instance has no account, the first account needs
the setup token (see `docs/admin/first-account.md`), so nobody can take it
over by registering first.

`scripts/backup.sh` runs the same check. If it reports a problem, the
backup writes it to stderr (cron mails it) and deletes no old backups in
that run, so the retention cannot replace good backups with backups of an
empty instance. The first line of its output and of `scripts/restore.sh`
names the project they work on.

## Moving an installation

Stop the stack, move the whole directory including `.env`, and start it
again:

    docker compose down
    mv /opt/dokunc /srv/dokunc
    cd /srv/dokunc && docker compose up -d

The name stays the same, because it does not depend on the directory any
more (or is pinned in `.env`).

## Several installations on one host

Give each installation its own name in its `.env`, for example with
`./scripts/projektname.sh --festschreiben NAME` for an existing one, or
`COMPOSE_PROJECT_NAME=wiki-test` for a new one. Do this in every checkout
before you update the first one: after the update, a checkout without a
pinned name uses the project `dokunc` and takes over the containers and
database of the installation that already has that name. Each also needs its own
`APP_PORT` (and `APP_BIND`), because the proxies cannot share a port.

## Renaming the project

Changing `COMPOSE_PROJECT_NAME` of an existing installation starts a new,
empty instance. To really rename it, keep the old name, or move the data:
make a backup with `./scripts/backup.sh`, stop the stack, set the new
name, start it, and restore the backup with `./scripts/restore.sh` (use
`--secret` if the secret was backed up separately).

## Restoring on a new host

Set the project name before the first start and before
`scripts/restore.sh`, if the installation used a name other than
`dokunc`. `restore.sh` restores into the project that
`./scripts/projektname.sh` shows.
