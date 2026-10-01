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

It prints the project, whether it has data (its volumes
`<project>_db_data` and `<project>_uploads`, the database and the
uploaded files) and which other dokunc projects (projects with
`db_data`, `redis_data` and `uploads` volumes) exist on this host. A
database volume alone does not count: another application that ran in
the same directory before (for example with the volumes `wiki_db_data`
and `wiki_redis_data`) is not taken for this installation's data. The
check does not rely on `app_data`: installations from before that volume
only get it at their first start with a newer version.

## Installations from before the fixed name

Before the fixed name, the project was named after the directory of the
checkout: lower case, with every character other than `a-z`, `0-9`, `_`
and `-` removed (`/srv/Wiki Alt` became `wikialt`). If your checkout is in
a directory called `dokunc` and no other installation runs on the host,
the name stays the same and there is nothing to do. With several
installations on one host, see "Several installations on one host" below.

Otherwise, run this once after `git pull` and before `docker compose up`:

    ./scripts/projektname.sh --festschreiben

It writes the previous name to `.env` (`COMPOSE_PROJECT_NAME=...`, with a
comment line), if that project has data (`<name>_db_data` and
`<name>_uploads`); otherwise it writes the current name. It adds a line
break first if the last line of `.env` has none, keeps the file's
permissions, and changes nothing if the name is already set in `.env` or
in the environment. If the previous name is not the directory name (for
example because you moved the checkout), give it explicitly; the script
accepts only a name whose `db_data` and `uploads` volumes exist:

    ./scripts/projektname.sh --festschreiben wiki

It refuses a name whose containers were created from another directory
that still exists, because that is another installation's project.

The script tells installations apart by their containers: Docker Compose
records the directory it created a container from (label
`com.docker.compose.project.working_dir`), also for stopped containers. A
project whose containers come from another directory that still exists
belongs to another installation. A directory that no longer exists does
not count, since containers of a checkout that was moved without
`docker compose down` still point to its old place. A project without
containers is judged by the age of its volumes only.

`./scripts/projektname.sh` without options detects a missed step:

- **Exit code 1:** the project has no data (no `db_data` or no `uploads`
  volume), but another dokunc project on this host has, and none of its
  containers come from another directory. This is the state after
  `git pull` and before the first start. Run `--festschreiben`.
- **Exit code 2:** the project has data, but it probably does not belong
  to this checkout. There are three cases:
  - The containers of the `dokunc` project come from another directory
    that still exists. The `dokunc` project belongs to another
    installation on this host, however old its volumes are.
    `docker compose up` here would take over that installation's
    containers and database: it re-creates them from this checkout's code
    and `.env` and runs this version's migrations against that database.
    Run `--festschreiben` here; it writes the directory's name if its
    volumes exist. A new checkout without data of its own needs a name of
    its own instead (`COMPOSE_PROJECT_NAME=...` in `.env`). Do not run
    `docker compose -p dokunc down`: it stops the other installation. If
    the other directory no longer holds an installation (for example an
    old copy of this checkout), run `docker compose down` (without `-v`)
    there and check again.
  - The project named after the directory has data, and the `dokunc`
    project has data that is not younger, but no containers from another
    directory (none, or already re-created from this checkout). The
    `dokunc` project probably belongs to another installation on this
    host, for example one in a directory named `dokunc`, and
    `docker compose up` here takes or took over its containers and
    database. Run `--festschreiben` here; it writes the directory's name.
    If `docker compose up` already ran, run `docker compose up -d` here
    and then in the other installation's directory. Do not run
    `docker compose -p dokunc down`: it stops the other installation. If
    `dokunc` is in fact the right project for this checkout, pin it with
    `./scripts/projektname.sh --festschreiben dokunc`.
  - Another dokunc project without containers from another directory has
    older volumes. The update was probably started without
    `--festschreiben`, and Docker Compose created a new, empty instance
    with a new secret next to your data. Your data is untouched in the
    old volumes; see the way back below. If the `dokunc` data does belong
    to this checkout (several installations on one host), pin it with
    `./scripts/projektname.sh --festschreiben dokunc`.

  The script reports none of these cases when `COMPOSE_PROJECT_NAME`
  sets the name explicitly.
- **Exit code 3:** the script could not ask Docker about the volumes, for
  example because your user may not use the Docker socket. Run it the way
  you run `docker compose` (with `sudo` if you use that). `--festschreiben`
  also stops with exit code 3 and changes nothing, as it does when it
  cannot write `.env` or a file next to it (the directory of `.env`, or of
  the file a symlinked `.env` points to, must be writable).

The way back after a missed step that started a new, empty instance:

    docker compose -p dokunc down
    ./scripts/projektname.sh --festschreiben
    docker compose up -d

The script names the first line only if containers of the `dokunc`
project come from this checkout. `down` without `-v` only removes the
containers of the new project; no volume is deleted. If the containers of
the old project were still running, the new stack could not start its
proxy ("port is already allocated"), and the old instance kept serving;
the last command updates it. If the `dokunc` project belonged to another
installation on this host before, run `docker compose up -d` in that
installation's directory afterwards, and keep its volumes. Otherwise, once
you have checked that your data is back, you may remove the empty volumes
of the new project
(`docker volume ls --filter label=com.docker.compose.project=dokunc`
lists them).

As long as the new, empty instance has no account, the first account needs
the setup token (see `docs/admin/first-account.md`), so nobody can take it
over by registering first.

`scripts/backup.sh` runs the same check, also with `--secret-sichern`,
and passes on to stderr whatever the check writes there (cron mails it),
including a hint without a problem. If the check reports a problem, the
backup deletes no old backups in that run, so the retention cannot
replace good backups with backups of an empty instance; with
`--secret-sichern` it warns that the secret comes from the named project.
The first line of its output and of `scripts/restore.sh` names the
project they work on.

## Moving an installation

Stop the stack, move the whole directory including `.env`, and start it
again:

    docker compose down
    mv /opt/dokunc /srv/dokunc
    cd /srv/dokunc && docker compose up -d

The name stays the same, because it does not depend on the directory any
more (or is pinned in `.env`).

## Going back to a version before the fixed name

Versions from before the fixed name have no `name:` in
`docker-compose.yml`. After `git checkout` of such a version, Docker
Compose names the project after the directory again, unless
`COMPOSE_PROJECT_NAME` is set. For a checkout in a directory called
`dokunc` that is the same project. Any other checkout that now uses the
project `dokunc` (for example one moved or cloned again after the update)
would start a new, empty instance, and `scripts/restore.sh` would restore
into that one. Pin the name before `git checkout`:

    ./scripts/projektname.sh --festschreiben dokunc

The older version reads `COMPOSE_PROJECT_NAME` from `.env` and keeps
using the same volumes. If the name is already pinned in `.env`, the
command changes nothing, and nothing else is needed.

## Several installations on one host

Give each installation its own name in its `.env`, for example with
`./scripts/projektname.sh --festschreiben NAME` for an existing one, or
`COMPOSE_PROJECT_NAME=wiki-test` for a new one. Do this in every checkout,
including one in a directory named `dokunc`, before you update the first
one: after the update, a checkout without a pinned name uses the project
`dokunc` and takes over the containers and database of the installation
that already has that name. Without pinned names, the check also judges by
volume age where containers are missing, and can report an installation
as a new, empty instance. Each also needs its own `APP_PORT` (and
`APP_BIND`), because the proxies cannot share a port.

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
