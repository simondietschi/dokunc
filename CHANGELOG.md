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
  invalid value used to crash both servers with a stack trace, and the
  value is no longer case-sensitive. On success the log shows one line
  "Konfiguration geprueft" with the values of the declared settings
  (secrets masked) and the names of the other settings that are set.
  Nothing to do for a working installation. If the container keeps
  restarting after the update, the line "Konfiguration ungueltig" in
  `docker compose logs app` names the setting to fix.

### Security

### Added

- Configuration check at startup for the web app and the collaboration
  server, with the effective configuration (secrets masked) in the log.

### Changed

- The web app, the collaboration server and the Prisma CLI no longer print
  a `dotenv` line ("injected env …") when they load the environment.

### Removed

### Fixed

- An invalid `LOG_LEVEL` no longer crashes both servers with a stack
  trace.
