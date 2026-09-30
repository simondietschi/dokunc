# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There has been no release yet. Installations run the `main` branch from Git
and update with the commands in the README section "Update und Rückweg".
The first release will be 0.9.0; from then on, releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until then,
"Unreleased" lists every change since this file was added; earlier changes
are in the Git history only.

Read "Upgrade notes" before every update. It lists each change that behaves
differently on an existing installation, and what to do about it.

## [Unreleased]

### Upgrade notes

- **Startup check:** the web app and the collaboration server now check
  their configuration at startup. When a checked setting is invalid, the
  server stops with exit code 78 and one `fatal` log line that lists every
  problem (field `errors`). The first checked setting is `LOG_LEVEL`: an
  invalid value used to crash both servers with a stack trace. Surrounding
  spaces and an empty value, which crashed them as well, are now accepted
  (empty means `info`). On success the log shows one line
  "Konfiguration geprueft" with the values of the declared settings
  (secrets masked) and the names of the other settings that are set.
  Nothing to do for a working installation. If the container keeps
  restarting after the update, the line "Konfiguration ungueltig" in
  `docker compose logs app` names the setting to fix.

- **Docker image contents:** images built from a checkout no longer
  contain `.env.*` files (except `.env.example`), `*.rdb` files,
  `app_secret`, `docker-compose.override.yml`, `.claude/`, `.github/`,
  `.gitleaksignore`, `CONTRIBUTING.md` or the test helpers in
  `apps/web/test`, also in subdirectories. If you relied on a file such as
  `.env.production` or `apps/web/.env.local` being read during the image
  build or when the web app starts, set the values in `.env` instead:
  Docker Compose passes them to the container, and
  `NEXT_PUBLIC_COLLAB_URL` to the build. Otherwise nothing to do.

### Security

- Docker images no longer include local environment files, Redis dumps,
  `app_secret` files or Compose overrides from the build directory.

### Added

- Configuration check at startup for the web app and the collaboration
  server, with the effective configuration (secrets masked) in the log.
- Code scanning with CodeQL (`security-extended` queries) for the JavaScript
  and TypeScript code and the GitHub Actions workflows, on pull requests,
  pushes to `main` and weekly; results appear under Security → Code
  scanning.
- CI scans the Git history for committed secrets with gitleaks (pinned
  version and checksum); a finding fails the run.

### Changed

- The web app, the collaboration server and the Prisma CLI no longer print
  a `dotenv` line ("injected env …") when they load the environment.

### Removed

### Fixed

- An invalid `LOG_LEVEL` no longer crashes both servers with a stack
  trace.
