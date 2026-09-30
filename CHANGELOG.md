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

- **Page protection on copies:** copies of protected pages, including
  protected sub-pages in a copied subtree, and pages created from a
  protected template are now protected themselves, with a copy of the
  access list at that moment. Each such copy is recorded as
  `page.protection_carried` in the audit log; SIEM or log filters that
  list audit events explicitly should add it. Pages created before this
  update keep their current visibility: review top-level pages whose title
  ends in "(Kopie)" and pages created from protected templates. To check
  that every page follows the protection of its parent page, run
  `docker compose exec -T db psql -U dokunc -d dokunc -c 'SELECT c.id, c.title FROM "Page" c LEFT JOIN "Page" p ON p.id = c."parentId" WHERE c."accessRootId" IS DISTINCT FROM CASE WHEN c."isRestricted" THEN c.id ELSE p."accessRootId" END'`.
  It should list no pages; a space admin fixes a listed page by moving it
  once in the page tree.

- **Templates from protected pages:** saving a protected page, or a page
  below a protected page, as a template now requires a space admin or
  owner, who confirms it in a dialog; other roles see a note instead of
  the menu entry. The template is visible to everyone in the space who
  uses templates. The action is recorded as `page.protection_changed` in
  the audit log; SIEM or log filters that list audit events explicitly
  should add it. Nothing else to do.

### Security

- Docker images no longer include local environment files, Redis dumps,
  `app_secret` files or Compose overrides from the build directory.
- Mail is sent with nodemailer 10.0.12. It fixes a denial of service
  through a crafted address (GHSA-v53p-9fqp-m79j, high), the reuse of one
  SMTP host's TLS server name for another through a shared DNS cache
  (GHSA-6vj9-mwq6-2f5v), a stack overflow on deeply nested recipient
  lists (GHSA-8vvx-rff5-p5rq) and a malformed envelope recipient built
  from a quoted local part with a comment (GHSA-g57g-f23g-4646).
- Duplicating a protected page, or a page with protected sub-pages, no
  longer creates copies that the whole space can read. Pages created from
  a protected template keep the template's protection.
- Members with access to a protected page could publish its content to
  the whole space by saving it as a template; this now requires a
  confirmed action by a space admin or owner.

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
- A password reset mail that failed because the SMTP server closed the
  connection before its greeting counted as a permanent failure, so the
  attempt stayed on the account's hourly limit. It now counts as a
  temporary connection error, like a refused or timed-out connection.
- When the SMTP server offered only XOAUTH2 login and `SMTP_USERNAME` was
  set, sending a notification mail crashed the collaboration server, and
  with it the web app when both run through `pnpm start`, as in the Docker
  image; password reset and invitation mails hung until the 30-second
  timeout. Mail now tries a password login there; if the server refuses
  it, the send fails right away with an authentication error in the log.
  dokunc logs in with a password only, so the server has to accept PLAIN,
  LOGIN or CRAM-MD5.
