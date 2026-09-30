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

- **Collab process errors:** an unhandled promise rejection no longer
  stops the collaboration server, and with it the web app when both run
  through `pnpm start` as in the Docker image. It is logged at level 50
  with the message "Unbehandelte Ablehnung, Collab-Server laeuft weiter".
  An uncaught exception is logged at level 60 ("Unbehandelter Fehler,
  Collab-Server beendet sich") before the process exits with code 1, as
  before. Monitoring that relies on container restarts to notice such
  errors should alert on these two lines instead.

- **Page saves and database connections:** the collaboration server no
  longer takes a Redis lock before it saves a page. Each save runs under a
  PostgreSQL advisory lock for that page, held on a separate pool of up to
  four database connections per collaboration server, in addition to its
  existing pool. If the database or a PgBouncer pool is close to its
  connection limit, raise it by four per collaboration server. PgBouncer in
  transaction mode works, and the lock transaction switches off
  `idle_in_transaction_session_timeout` for itself. A save that waits more
  than 30 seconds for the lock fails with "Speicherlauf gescheitert,
  Dokument bleibt im Speicher" (cause "Speichersperre fuer Seite …
  nicht erhalten"); the next edit of the page saves it again. If the
  database ends a lock connection during a save (a restart, a failover, a
  PgBouncer restart or `pg_terminate_backend`), the collaboration server
  keeps running, logs "Speichersperre: Verbindung waehrend des
  Speicherlaufs abgerissen", and that save fails the same way (cause
  "Speichersperre fuer Seite … verloren"). Redis keys
  `hocuspocus:<pageId>:lock` are no longer written; existing ones expire
  within a second.

- **Redis outages:** the collaboration server no longer needs Redis to open
  or save pages. While Redis is down, a page no longer shows "Verbinde…"
  until Redis is back: once Redis has been gone for more than a second,
  it opens at once, and before that after at most about five seconds; the
  web app's ticket request can still take a few seconds then. With
  several collaboration servers, an editor sees changes made on another
  server only when its own server saves the page again, and live again
  once Redis is back; open pages are then resynchronised without further
  typing. During the outage, each collaboration server also keeps its own
  record of used collaboration tickets, so a ticket (valid for two
  minutes, for one user and page) can open that page once on each server
  rather than once in total. A Redis that refuses the collaboration
  server, for example because of a wrong password, no longer keeps pages
  from opening: they open after a few seconds, and the log shows
  "Dokument ohne Abgleich mit anderen Instanzen geladen, Redis nicht
  erreichbar" (at most once per ten seconds). Alert on that line to notice
  such a misconfiguration. Nothing else to do.

- **Single sign-on with Microsoft Entra ID:** providers that send no
  `email_verified` now work. `xms_edov: true` from Entra ID counts as a
  verified address, and when the ID token carries no address, or one
  without `email_verified` and `xms_edov`, the sign-in also asks the
  provider's userinfo endpoint (its `sub` must match). The new settings
  `OIDC_TRUSTED_EMAIL_DOMAINS`, `OIDC_EMAIL_CLAIM`, `OIDC_NAME_CLAIM` and
  `OIDC_SUBJECT_CLAIM` are described in `docs/admin/sso.md`;
  `docker-compose.yml` passes them through, and an invalid value stops the
  start with an error that names the variable. With
  `OIDC_AUTO_LINK_BY_EMAIL=true` (the default), existing accounts are now
  linked on the first SSO sign-in of such providers, where this failed
  before: if addresses in your directory can be reassigned, set
  `OIDC_AUTO_LINK_BY_EMAIL=false` before you update. Only the issuer of a
  single tenant works (`https://login.microsoftonline.com/<tenant-id>/v2.0`);
  `common`, `organizations` and `consumers` fail with a log line that says
  so.

- **Changing `OIDC_SUBJECT_CLAIM`:** when you set it to `oid`, as
  recommended for Entra ID, each existing binding moves to the object ID on
  the person's next sign-in. There is no automatic way back. Before you
  switch back to `sub` or go back to an older version, clear the bindings
  with `UPDATE "User" SET "oidcSubject" = NULL, "oidcIssuer" = NULL WHERE
  "oidcIssuer" = '<issuer>'`; the next sign-in then links the accounts
  again by verified email address (with `OIDC_AUTO_LINK_BY_EMAIL=true`,
  never for admin accounts). Versions before this update do not know
  `xms_edov`, so Entra ID accounts sign in there with their password, as
  they did before.

- **Password sign-in for accounts linked to single sign-on:** the new
  setting `SSO_ENFORCEMENT` defaults to `linked_accounts`, also on existing
  installations. Accounts linked to an OIDC provider then sign in only
  through the provider: the password sign-in answers "Falsche
  Zugangsdaten" even for the right password, "Passwort vergessen" sends
  them no link, and reset links issued before the update no longer work
  for them. This holds for every linked account, whatever issuer it is
  linked to and also while SSO is not configured. Self-service actions
  that ask for the current password (change password, delete account,
  turn off two-factor authentication, new recovery codes) are not
  available to linked accounts that never set a password; admins can
  delete such accounts and reset their two-factor authentication in the
  admin area. If your own admin account was created through SSO or linked
  to it, it loses the password sign-in: make sure another admin account
  with a password exists before you update (admin accounts are never
  linked automatically). If your provider is down, or after you switched
  providers or turned SSO off, set `SSO_ENFORCEMENT=off` and restart; set
  it back afterwards. See `docs/admin/sso.md`.

- **Password reset only for active accounts:** deactivated accounts get
  no reset link any more, and links issued before the deactivation no
  longer work. Nothing to do.

- **Setup token for the first account:** as long as an instance has no
  account, the web app writes a one-time token to `/app/data/setup_token`
  (volume `app_data`) and prints it once in the log. The first account,
  which becomes instance admin, is created only with this token, for a
  password registration and for the first sign-in through single sign-on.
  No token is needed when `APP_URL` points to `localhost` and the site is
  opened as `localhost`, as in the quick start. Set `APP_URL` to the public
  address before the instance is reachable from outside: behind a proxy
  that rewrites the host name to `localhost` and passes no public name, a
  registration or the return from a single sign-on provider would
  otherwise count as local. Installations that already have an account
  are not affected. An instance that is deployed but has
  no account yet, also after its database volume was emptied, needs the
  token: read it with `docker compose exec app cat /app/data/setup_token`
  and enter it on `/register` or, for single sign-on, on the sign-in page.
  Outside Docker, set `SETUP_TOKEN_FILE` to a writable absolute path. See
  `docs/admin/first-account.md`.

- **First account through single sign-on:** it now also needs an email
  address the provider confirms, even on `localhost`; `OIDC_ALLOW_SIGNUP`
  still does not apply to it. Creating the first account with a password
  remains the recommended way.

- **No npm in the app image:** the app image no longer contains `npm`
  and `npx`. The container starts, migrates and answers its healthcheck
  without them, and `scripts/backup.sh` and `scripts/restore.sh` do not
  use them. If you run npm or npx in the app container yourself, use pnpm
  instead, for example
  `docker compose exec app pnpm --filter @dokunc/db exec prisma migrate status`.
  Otherwise nothing to do.

- **Client addresses:** the web app now writes IPv4 addresses that arrive
  in IPv6 form (`::ffff:192.0.2.1`) as plain IPv4 (`192.0.2.1`), like the
  collaboration server. This changes the stored form in the audit log
  (`ip`), in the session list and in the rate-limit keys in Redis; adjust
  log or SIEM filters that match the old form. An `X-Forwarded-For` entry
  that is not an IP address no longer becomes the client address; such
  requests count as unknown. When `TRUSTED_PROXY_HOPS` does not match the
  proxy chain, both servers now log "Client-Adresse nicht bestimmbar,
  Anfragen zaehlen unter unknown" (at most one line per reason every ten
  minutes); see `docs/admin/network.md`. Nothing to do otherwise.

- **Proxy in front of the bundled Caddy:** Caddy no longer
  overwrites `X-Forwarded-For`. It keeps the header from the addresses in
  the new setting `TRUSTED_PROXIES` and appends the address it saw; from
  everybody else it still replaces it. If a load balancer, WAF or CDN sits
  in front of Caddy, set `TRUSTED_PROXIES` in `.env` to its addresses,
  separated by spaces (a comma stops the start), and `TRUSTED_PROXY_HOPS=2`
  (one more for each further proxy). Until you do, everybody behind it
  keeps sharing one rate-limit counter, and the audit log and session list
  show no usable address. From trusted proxies Caddy also passes
  `X-Forwarded-Proto` and `X-Forwarded-Host` on: the proxy must send
  `X-Forwarded-Proto: https`, and `APP_URL` must be the public address,
  otherwise the editor connection and form submissions fail. For a proxy
  on the same host, list the gateway address of the Compose network `edge`,
  not `127.0.0.1`. If you edited the `Caddyfile`, merge the new global
  `servers` block and remove both `header_up X-Forwarded-For
  {remote_host}` lines. Without a proxy in front of Caddy, nothing to do.
  To go back to an older version, set `TRUSTED_PROXY_HOPS=1` again. See
  `docs/admin/network.md`.

- **Invalid `TRUSTED_PROXY_HOPS` stops the start:** only whole
  numbers from 0 to 10 are accepted. Any other value used to count silently
  as 0, so all per-address rate limits shared one counter. If the server
  stops with "Konfiguration ungueltig" naming `TRUSTED_PROXY_HOPS`, set the
  number of your own proxies (1 with the bundled Caddy). The web app now
  also warns at startup when it runs in production with
  `TRUSTED_PROXY_HOPS=0`, and both servers warn when `TRUSTED_PROXIES` is
  set but `TRUSTED_PROXY_HOPS` is below 2.

- **Single sign-on limit per address:** starting a single sign-on is now
  limited to 600 per hour per client address instead of 20 per 5 minutes,
  so that a site behind one NAT address can sign in at the start of the
  day. To keep a lower limit, set `RATE_LIMIT_SSO_START_PER_IP`, for
  example `20/5m`. Nothing to do otherwise.

- **Per-address rate limits in the environment:** the new optional
  settings `RATE_LIMIT_LOGIN_PER_IP`, `RATE_LIMIT_REGISTER_PER_IP`,
  `RATE_LIMIT_RESET_REQUEST_PER_IP`, `RATE_LIMIT_RESET_SUBMIT_PER_IP` and
  `RATE_LIMIT_SSO_START_PER_IP` (format `30/5m`) set the web app's limits
  per client address; `docker-compose.yml` passes them through, and an
  invalid value stops the start. Use the same values on every instance.
  Nothing to do if the defaults fit; see `docs/admin/network.md`.

- **Upload limit per account:** file uploads are now limited to 30 per
  minute per account instead of per client address, so that people behind
  one address no longer slow each other down. The new setting
  `RATE_LIMIT_UPLOAD_PER_USER` (format `30/1m`) changes the limit.
  Nothing to do.

- **Corporate NAT and VPN:** the new setting `RATE_LIMIT_EXEMPT_NETWORKS`
  (IP addresses or CIDR ranges) exempts client networks from the
  per-address limits: password sign-in, registration, password reset and
  single sign-on start in the web app, and connection attempts and open
  connections per address in the collaboration server. Limits per account
  still apply. On the collaboration server, a single computer in an exempt
  network can fill the whole instance (up to `COLLAB_MAX_CONNECTIONS`)
  with connections that never sign in, so list only networks you trust.
  If you raised `COLLAB_MAX_CONNECTIONS_PER_IP` or
  `COLLAB_MAX_ATTEMPTS_PER_IP` for a NAT, list the NAT address here instead
  and set those back to their defaults: raised limits apply to every
  address. Use the same value on every web app and collaboration server.
  Nothing to do otherwise; see `docs/admin/network.md`.

- **Password confirmation limit:** changing the password, deleting the
  account, turning off two-factor authentication and issuing new recovery
  codes now share one limit of 10 attempts per 10 minutes per account,
  across all sessions. Before, the first two had no limit and the other two
  allowed 10 each. A session in which the current password is entered
  wrongly 10 times is signed out ("Zu viele falsche Passwörter …"); this
  also happens to accounts linked to single sign-on that guess a password
  they never set. Each failure is recorded as `auth.reauth_failed` in the
  audit log, with `operation`, `reason` and, when the session ended,
  `sessionEnded`. Nothing to do.

- **Wiki links:** a wiki link now shows the current title of the linked
  page, and only to readers who can open that page; everyone else sees
  "Seite ohne Zugriff" without a link, also when the target is in the
  trash or deleted. While the title loads, the link shows "…", and
  "Verknüpfte Seite" when the title cannot be loaded. Links added in the
  editor no longer store the title of their target. Exports (Markdown,
  HTML, PDF) and the print view show wiki links as plain text without a
  link target, also to pages the reader can open, and mentions without
  the internal user ID.
  Shared pages show wiki links as plain text as well, with the current
  title only for pages that belong to the share (the shared page and,
  when sub-pages are included, its open sub-pages) and "Verknüpfte Seite"
  for every other target; they no longer contain internal page or user
  IDs. The version comparison shows current titles, so renaming a linked
  page no longer shows up there as a change. The template picker shows
  "Verknüpfte Seite" in its preview instead of link titles. Tools that
  read link targets (`/p/<id>`) from Markdown or HTML exports now find
  plain text; adjust them. The editor loads titles from
  `GET /api/pages/titles`: if a proxy in front of the app only passes
  listed paths, add this path, otherwise links that others add while a
  page is open show "Verknüpfte Seite" there.

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
- Single sign-on could be bypassed with a password reset: a person
  disabled at the identity provider who could still read their mailbox
  (external address, forwarding, guest) could set a local password
  through "Passwort vergessen" and keep signing in. Accounts linked to
  single sign-on now have neither password sign-in nor password reset.
- Reset links of deactivated accounts stayed valid and set a password
  that applied again after a reactivation.
- Takeover of a freshly deployed instance: anyone who reached a new
  instance before its operator could register the first account and
  become instance admin, through single sign-on even without a verified
  address and without `OIDC_ALLOW_SIGNUP`. The first account now needs a
  setup token unless the instance runs on `localhost`, and two
  simultaneous first registrations can no longer both become admins.
- The app image no longer contains npm and npx, which nothing in the
  container uses. The npm bundled with the Node base image brought its
  own dependencies with high-severity vulnerabilities (brace-expansion
  5.0.9: CVE-2026-102276, CVE-2026-102278; undici 6.28.0:
  CVE-2026-19534), which the image scan reported although dokunc never
  loads them.
- An `X-Forwarded-For` entry that is not an IP address is no longer used as
  the client address. With `TRUSTED_PROXY_HOPS` set higher than the real
  number of proxies, a client could choose its own rate-limit counter with
  every request and write any text, up to the header size limit, into the
  audit log, the session list and Redis keys.
- The current password asked for when changing the password or deleting the
  account could be guessed without limit, and the two-factor forms had a
  limit of their own each: from a briefly unattended session, the password
  and with it the account could be taken over. All four forms now share
  one limit of 10 attempts per 10 minutes per account, the session ends
  after 10 wrong passwords, and every failure is in the audit log.
- Wiki links revealed the title of the linked page to every reader of the
  linking page, also after the target was protected or renamed: in the
  editor, on shared pages, in exports, the print view, the version history
  and the template preview, and for imported pages in search results and
  the AI index. They now show the current title only to readers who can
  open the target, and imports no longer put the text of wiki links into
  the search text. The title stored in existing links is still delivered
  to readers of the linking page with the page data and is still included
  when such a link is copied as text; links added in the editor no longer
  store it. Pages imported before this version keep the text of their
  wiki links in the search text until they are next edited. Shared pages
  no longer contain internal page and user IDs.
- Deleting a group left its members' open editors connected until the
  collaboration server's next periodic check, up to a minute, so they
  could keep reading and writing pages they had lost access to. They are
  now disconnected at once, in every space where the group had a role or
  access to a protected page. Removing a member from a group now also
  disconnects them in spaces where the group only had access to a
  protected page.

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
- Single sign-on: `OIDC_TRUSTED_EMAIL_DOMAINS`, `OIDC_EMAIL_CLAIM`,
  `OIDC_NAME_CLAIM` and `OIDC_SUBJECT_CLAIM`; support for Entra ID's
  `xms_edov` claim; a userinfo fallback for providers that send the email
  address or its verification only there. The audit entries
  `auth.sso_linked` and `auth.registered` record which claim the address
  came from (`emailSource`) and what verified it (`verifiedBy`).
- `docs/admin/sso.md`: provider settings, how dokunc decides that an
  address is verified, a warning about account takeover through email
  claims, and the setup for Microsoft Entra ID, Google, Keycloak and
  authentik.
- `SSO_ENFORCEMENT` (`linked_accounts`, `off`) for the password sign-in of
  accounts linked to single sign-on. Refused password sign-ins, reset
  requests and reset links record the reasons `sso_required` and
  `inactive` in the audit log (`auth.login_failed`).
- Setup token for the first account (`SETUP_TOKEN_FILE`,
  `docs/admin/first-account.md`) and the audit event
  `auth.first_admin_created`; refused first registrations record the
  reason `setup_token`.
- `docs/admin/network.md` on how the web app and the collaboration server
  determine client addresses.
- `TRUSTED_PROXIES` for the bundled Caddy: upstream proxies whose
  `X-Forwarded-For` it keeps. The web app and the collaboration server
  check its format at startup and warn (reason `address_is_proxy`) when
  the client address they find is one of these proxies and
  `X-Forwarded-For` names more addresses before it.
- Settings for the web app's rate limits per client address
  (`RATE_LIMIT_LOGIN_PER_IP`, `RATE_LIMIT_REGISTER_PER_IP`,
  `RATE_LIMIT_RESET_REQUEST_PER_IP`, `RATE_LIMIT_RESET_SUBMIT_PER_IP`,
  `RATE_LIMIT_SSO_START_PER_IP`), checked at startup.
- `RATE_LIMIT_UPLOAD_PER_USER` for the upload limit per account.
- `RATE_LIMIT_EXEMPT_NETWORKS` for the web app and the collaboration
  server: client networks (corporate NAT, VPN) that do not count for the
  per-address limits; see "Corporate NAT and VPN" in
  `docs/admin/network.md`.
- Audit event `auth.reauth_failed` ("Passwortbestätigung fehlgeschlagen").
- `GET /api/pages/titles`: the current titles of pages the signed-in user
  can open, used by wiki links in the editor.

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
- The sign-in message for an unverified address now says that the provider
  does not confirm it and that it can neither take over nor create an
  account ("Der Anbieter bestätigt diese E-Mail-Adresse nicht."). Which
  rule applied is recorded in the audit log.
- With single sign-on configured, the sign-in form adds under "Falsche
  Zugangsdaten" that linked accounts sign in with "Weiter mit …", and the
  confirmation of "Passwort vergessen" says the same, for every address.
  The account page tells a linked account that its password only confirms
  actions on that page.
- The registration page says "Nur per Einladung." once an instance has an
  account. While it has none, the sign-in and registration pages explain
  the first setup and ask for the setup token where it is needed.
- The web app and the collaboration server share one implementation of the
  client address; the web app now normalizes IPv4-mapped IPv6 addresses
  like the collaboration server.
- The default limit for single sign-on starts per client address is 600
  per hour (was 20 per 5 minutes).
- The upload rate limit counts per account instead of per client address.

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
- When Redis failed while two collaboration servers synchronized a page
  (for example during a Redis restart), the answer to the other server
  could not be published, and the resulting unhandled promise rejection
  stopped the collaboration server and, through `pnpm start`, the web
  app. Failed publishes and unreadable messages from other collaboration
  servers are now logged as warnings ("redis-ha: …", at most one line per
  ten seconds each).
- Edits could be missing from the database after Redis was unreachable or
  out of memory, or when two collaboration servers saved the same page
  within a second: the Redis lock before saving failed, the save was
  skipped, and the page was unloaded without it. Saving no longer depends
  on Redis.
- When two collaboration servers held edits the other did not have, for
  example during a Redis outage, the server that saved last overwrote the
  other's edits in the database. A save now takes over what another
  server saved in the meantime. A saved state that cannot be read is
  logged ("Gespeicherter Stand nicht lesbar, ohne Zusammenfuehren
  gespeichert") and overwritten as before.
- Opening a page while Redis was unreachable waited until Redis came back;
  the editor showed "Verbinde…" all that time.
- After Redis came back, collaboration servers stayed out of sync until
  the next edit.
- While Redis was reconnecting, each connection attempt and each save of
  the collaboration server waited several seconds per Redis command
  before it fell back. After a second of outage they now fall back at
  once.
- A multi-tenant Entra ID issuer (`common`, `organizations`) failed with
  "OIDC-Aussteller stimmt nicht mit der Konfiguration" without naming the
  cause. The log now says that only the issuer of a single tenant is
  supported.
- Behind a load balancer, WAF or CDN, the bundled Caddy replaced
  `X-Forwarded-For` with the proxy's address. With the
  `TRUSTED_PROXY_HOPS=2` that `.env.example` recommended for this case,
  every request then counted as unknown: all users shared one rate-limit
  counter, and the audit log and session list recorded no address.
- Caddy's `{client_ip}` (access log, matchers) no longer takes the leftmost
  `X-Forwarded-For` entry, which the client can write, from a trusted
  proxy.
