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
  update keep their current visibility, and the query below does not find
  them: review every page whose title ends in "(Kopie)", at any level of
  the page tree, together with its sub-pages, and the pages created from
  protected templates. To check that every live page follows the
  protection of its parent page, run
  `docker compose exec -T db psql -U dokunc -d dokunc -c 'SELECT c.id, c.title FROM "Page" c LEFT JOIN "Page" p ON p.id = c."parentId" WHERE c."deletedAt" IS NULL AND NOT c."isTemplate" AND c."accessRootId" IS DISTINCT FROM CASE WHEN c."isRestricted" THEN c.id ELSE p."accessRootId" END'`.
  It should list no pages; a space admin fixes a listed page by moving it
  to another place in the page tree and back. Pages in the trash are
  corrected when they are restored.

- **Templates from protected pages:** saving a protected page, or a page
  below a protected page, as a template now requires a space admin or
  owner, who confirms it in a dialog; other roles see a note instead of
  the menu entry. The template is visible to everyone in the space who
  uses templates. The action is recorded as `page.protection_changed` in
  the audit log; SIEM or log filters that list audit events explicitly
  should add it. Templates saved from protected pages before this update
  are visible the same way: review the existing templates of each space.

- **Moving protected pages:** moving a page out of a protected area, or
  from one protected area into another, now requires a space admin or
  owner, who confirms it in a dialog; other roles get an error message.
  Moving an open page into a protected area stays allowed for everyone who
  can move pages and open the target. Every move that changes who can see
  a page is recorded as `page.protection_changed` in the audit log and
  revokes the share links of the moved pages. Nothing else to do.

- **Restored and detached pages:** a page restored while its protected
  parent stays in the trash, and a live sub-page detached when a protected
  page above it is permanently deleted (by hand or by the trash retention
  job), now keep that protection as a protected page of their own, with a
  copy of the access list. The same applies to pages created below
  imported pages when the import is rolled back. Each case is recorded as
  `page.protection_carried`; entries of the retention job have no actor
  and `automatisch: true`. Pages restored or detached before this update
  keep their current visibility: check the top-level pages named in
  earlier `page.restored` audit entries. Sub-pages detached by an earlier
  permanent deletion or import rollback cannot be traced from the audit
  log: review the open top-level pages of each space.

- **Permanent deletion:** only space admins and owners can permanently
  delete pages from the trash. Members no longer see the delete button
  there, only a note. Members who emptied the trash by hand ask a space
  admin now, or set `TRASH_RETENTION_DAYS` so the trash empties itself.

- **Templates:** templates no longer appear in search (search palette and
  space search) or in the list of recently changed pages, for any role.
  Open them from the templates page or the template picker. Nothing else
  to do.

- **Open editor tabs:** editor tabs that were opened before this update
  stop syncing and show "Kein Zugriff"; reload them. From now on, after an
  update that changes the editor, open tabs show "Neue Version" with a
  reload button instead and stay read-only until they are reloaded.

- **Collab ticket requests:** `POST /api/collab/ticket` now requires the
  field `schema` (the editor's schema hash). Requests without it or with
  a different hash get `409` with `{"code":"stale-client"}`, also without
  a session, where they used to get `401`. Only monitoring or scripts
  that call this route need to expect the new answer; otherwise nothing
  to do.

- **Editor schema in the database:** a migration adds two columns to
  `InstanceState`. At startup the collaboration server records the
  version of its editor there and stops with a `fatal` line
  ("Schema-Marke nicht in die Datenbank geschrieben") if it cannot. From
  now on, a collaboration server whose editor is older than the recorded
  one accepts no editors: they show "Aktualisierung läuft", and the log
  says "Editor-Schema dieser Instanz ist aelter als die Marke in der
  Datenbank". Go back to an older version only with the backup from
  before the update, as the README describes. Nothing to do for this
  update.

- **Stored page content:** the collaboration server now stores page
  content only if the editor can display it. If the log shows
  "Seiteninhalt nicht uebernommen" for a page after the update, the
  page's search text, export, share link and version history keep its
  last displayable state until the element named in `unknownNodes` or
  `unknownMarks` is removed from the page; the page itself keeps
  everything. Existing pages are expected to pass. Nothing to do
  otherwise.

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
- Members could remove a page's protection by moving it out of the
  protected area. Moves that lift the protection or switch to another
  protected area now require a confirmed action by a space admin or
  owner. Editors who lose access through a move are disconnected
  immediately instead of after up to 60 seconds, and share links in the
  moved subtree no longer come back to life when it leaves the protected
  area.
- Restoring a page whose protected parent is still in the trash,
  permanently deleting a page with live sub-pages (by hand or by the trash
  retention job) and rolling back an import no longer make the affected
  pages visible to the whole space.
- Any member could permanently delete every page they could see from the
  trash, with its versions and comments; permanent deletion is now
  limited to space admins and owners.

### Added

- Configuration check at startup for the web app and the collaboration
  server, with the effective configuration (secrets masked) in the log.
- Code scanning with CodeQL (`security-extended` queries) for the JavaScript
  and TypeScript code and the GitHub Actions workflows, on pull requests,
  pushes to `main` and weekly; results appear under Security → Code
  scanning.
- CI scans the Git history for committed secrets with gitleaks (pinned
  version and checksum); a finding fails the run.
- Editor: a tab running an outdated editor shows "Neue Version" with a
  reload button and stays read-only. While the web app and the
  collaboration server run different versions, the editor shows
  "Aktualisierung läuft" and retries by itself.
- The collaboration server logs the editor schema version and hash at
  startup ("Editor-Schema").
- The collaboration server records the newest editor schema it has run
  with in the database. As soon as a server with a newer editor has
  started, servers with an older one disconnect their editors and accept
  no new ones, also when an older version is started again later on the
  same data.
- `docs/admin/upgrading.md`: what an update does to open editor tabs, the
  deploy order for separate services and several collaboration servers,
  rolling back across an update that changed the editor, and the log
  lines to watch.

### Changed

- The web app, the collaboration server and the Prisma CLI no longer print
  a `dotenv` line ("injected env …") when they load the environment.
- Search and the list of recently changed pages no longer show templates.
- Collab tickets carry the editor schema hash (claim `sh`). The
  collaboration server rejects tickets without it or with a different
  hash before any other check, with the reason `schema-mismatch` and the
  log line "Collab-Verbindung abgewiesen" (at most one line per ten
  seconds, with the number of skipped rejections in `sinceLast`).
- The collaboration server checks page content against the editor schema
  before it stores it. Content that cannot be displayed (unknown block
  types or marks, or attribute values the editor rejects) stays in the
  collaborative state but no longer replaces the stored page content used
  by search, export, sharing, printing and page history; the error line
  "Seiteninhalt nicht uebernommen: Elemente ausserhalb des
  Editor-Schemas" names the types. Unknown attributes and structural
  deviations are stored as before, with the warning "Seiteninhalt weicht
  vom Editor-Schema ab, trotzdem uebernommen" at most once per hour and
  page.
- Several collaboration servers or separate web and collaboration
  services: update all of them to the same release, collaboration servers
  first (see `docs/admin/upgrading.md`).

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
- A browser tab still running an older editor after an update can no
  longer delete content with newer block types, marks or attributes for
  everyone: the web app and the collaboration server compare the editor
  schema before a tab may sync.
