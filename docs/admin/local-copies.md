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
  sent are not sent under the other account.
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

## Open tabs

If another tab deletes a copy that is open (limits, another account), the
editor stays connected and keeps working without a local copy. Its "Offline"
tooltip then says that changes not yet sent live only in the tab and are lost
when the tab is closed or reloaded.

## Rolling back

An earlier version does not know the new names. It leaves the copies made by
this version in the browsers and creates copies without an account again. The
next update deletes those.
