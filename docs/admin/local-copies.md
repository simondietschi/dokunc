# Local page copies in the browser

The editor keeps a copy of every page it opens in the browser's IndexedDB.
This page says what the copy holds, whom it belongs to and when it is
deleted. It matters for shared computers and for privacy reviews.

## What the browser keeps

- **One database per page and account.** Its name is
  `dokunc:v2:<account ID>:<restore epoch or ->:<page ID>:<editor version>`.
  It holds the page's shared editing state, including diagram data stored in
  the page. The copy shows the page quickly and holds changes that had not
  reached the server when the connection dropped; they are sent at the next
  connection.
- **One `localStorage` entry per copy**, `dokunc:lokale-kopie:<name>`, with
  the time the copy was last used. The limits below use it.

Editing without a connection is not possible: the editor becomes read-only
until the connection is back. Copies made by versions before accounts were
part of the name were called `dokunc:<page ID>` or
`dokunc:<restore epoch>:<page ID>`.

## Whom a copy belongs to

A copy belongs to one account, one restore epoch and one editor version.
The editor opens only its own account's copy of a page.

- **Another account signs in in the same browser.** Cookies apply to the
  whole browser, so open editor tabs of the previous account would fetch
  their next connection ticket with the new account's session. The ticket
  answer names the account; a tab that sees another account stops syncing,
  shows "Kein Zugriff" and deletes its copy of the page. Changes it had not
  sent are not sent under the other account. They exist only in that tab
  and are lost when it is closed or reloaded; the tab says so above the
  page.
- **Another editor version.** A copy from an older version of the editor is
  merged into the page before the editor connects and is then deleted. A copy
  from a newer version (after a rollback) is neither opened, deleted nor
  counted.
- **Another restore epoch.** `scripts/restore.sh` gives the instance a new
  restore epoch (README, section "Sicherung und Rückweg"). Copies from
  before the restore are never opened; they would bring back changes made
  after the backup.

## When copies are deleted

| Event | What is deleted |
|---|---|
| Signing out (`POST /logout`) | All copies, and over HTTPS the site's storage and cache |
| "Gerät abmelden" for the own device, "Überall abmelden", deleting the account: the browser loads `GET /session-ended` | All copies, and over HTTPS the site's storage and cache |
| The next full page load (reload, typed address, bookmark) after the session ended elsewhere (idle timeout, "Gerät abmelden" or "Überall abmelden" on another device, a password change on another device), through `GET /session-ended` | All copies, and over HTTPS the site's storage and cache |
| The sign-in page is shown without a valid session | All copies. Over HTTPS, if the browser still sent the ended session's cookie or still held page copies, the page then loads `GET /session-ended` once: the site's storage and cache as well |
| The server confirms the account in an editor tab (every connection) | Copies of other accounts and other restore epochs, and all copies made by earlier versions without an account |
| The server refuses a page for good: access removed, page in the trash or deleted | The copy of that page |
| The server answers that the session is no longer valid | All copies in the browser |
| More than 50 copies of the signed-in account | The least recently used ones beyond 50 |
| A copy unused for 30 days | That copy |

The limits are checked every time an editor tab gets a connection ticket.
Copies used in the last six hours are never removed by the limits, because
another tab may have them open; an open editor refreshes its entry every
five minutes. A network error, a rate limit, a server error or a refused
origin (`APP_URL` wrong) deletes nothing.

## Signing out and ended sessions

Without a valid session there are no local copies. Three things enforce
that:

- `POST /logout` and `GET /session-ended` answer with
  `Clear-Site-Data: "cache", "storage"`. The browser then deletes the site's
  IndexedDB and `localStorage` (page copies, theme, table-of-contents
  setting) and its HTTP cache (including images and files of protected
  pages). Browsers apply the header only over HTTPS and on `localhost`, and
  the app sends it only for a page navigation from the site itself or typed
  in (`Sec-Fetch-Dest: document`, `Sec-Fetch-Site: same-origin` or `none`).
- The sign-in page deletes all page copies itself when nobody is signed
  in. This also works over plain HTTP.
- The editor deletes all copies when the server answers that the session
  is no longer valid.

Only a full page load with the ended session's cookie goes through
`/session-ended` directly. These ways reach the sign-in page without the
header:

- a click inside the app, which loads the next page without a full page
  load;
- a link from another site, for example in a mail: the header is only sent
  for navigations from the site itself, so `/session-ended` keeps the old
  cookie and sends the browser on to the sign-in page;
- the sign-out after too many wrong passwords;
- a session that expires together with its cookie (`JWT_EXPIRES_IN`).

There the sign-in page deletes the page copies and, over HTTPS and on
`localhost`, loads `/session-ended` once if the browser still sent the old
session cookie or still held page copies; that response carries the header.
The browser cache keeps files of opened pages only over plain HTTP, and over
HTTPS when the sign-in page finds neither the old cookie nor page copies,
for example after a cookie expired together with its session while an open
editor had already deleted the copies.

A reverse proxy that only forwards listed paths must allow `/logout` and
`/session-ended`. `/logout` accepts only posts from the app's own origin
(`APP_URL`); otherwise it shows a page that names `APP_URL` and the session
stays. `/session-ended` changes nothing for a signed-in browser. When the
sign-in page loads `/session-ended`, the page to open after signing in
(`next`, for example from a notification mail or an invitation) and a
single sign-on error hint (`sso`) come back with it; `next` is kept only as
a path on this site.

Signing out, "Überall abmelden" and "Gerät abmelden" for this device ask
for confirmation when an editor in any tab of the browser has changes the
server has not confirmed. The question reaches the other tabs through a
`BroadcastChannel` and waits at most 300 ms for an answer; a tab the browser
has frozen does not answer. An idle timeout or a sign-out from another
device cannot ask first. An editor tab with such changes says so when it
notices the ended session: its local copy is deleted, and the changes exist
only in the open tab until it is closed or reloaded.

## Open tabs

If another tab deletes a copy that is open (limits, another account, signing
out), the editor stays connected and keeps working without a local copy. Its
"Live" and "Offline" tooltips then say that changes not yet sent live only in
the tab and are lost when the tab is closed or reloaded. The "Kein Zugriff"
tooltip says the same when the editor deleted its own copy after the server
refused the page or the session, or after another account signed in.

## Rolling back

An earlier version does not know the new names. It leaves the copies made by
this version in the browsers, also when someone signs out, and creates copies
without an account again. The next update deletes those.
