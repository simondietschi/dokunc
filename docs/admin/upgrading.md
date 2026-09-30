# Upgrading

This page covers what an update does to open editor tabs, in which order to
update several servers, and how to go back to an older version. The update
commands themselves are in the README, section "Update und Rückweg". Read the
"Upgrade notes" in `CHANGELOG.md` before every update.

## Editor versions and open tabs

Every page is edited in a shared document. An editor that does not know a
block type, a text mark or an attribute removes it from that document when it
opens the page, and the removal reaches everyone. So a browser tab, the web
app and the collaboration server must run the same version of the editor.
They compare a hash of the editor's schema (its block types, marks and
attributes) before a tab may sync:

| What the tab shows | Meaning | What to do |
|---|---|---|
| "Neue Version" with a "Neu laden" button | The tab still runs the editor from before an update that changed it. It is read-only and sends nothing. | Reload the tab. |
| "Aktualisierung läuft" | The web app and the collaboration server run different editor versions, usually for a moment during an update. The tab retries by itself about every 15 seconds. | Nothing, unless it stays: then see "Separate services or several collaboration servers" and "Rolling back". |
| "Kein Zugriff" right after the update that introduced this check | The tab's code predates the check. | Reload the tab. |

Updates that do not change the editor keep open tabs working; they reconnect
by themselves. An update that changes the editor says so in its upgrade
notes. Changes that a tab had not sent before the update are not guaranteed
to survive the reload.

## Deploy order

### One container (the default Compose setup)

The `app` container runs the web app and the collaboration server from one
build, so both always run the same editor. `docker compose up -d` replaces
them together, and every editor connection drops during the restart. After an
update that changed the editor, open tabs show "Neue Version".

### Separate services or several collaboration servers

The default Compose setup does not run this way. If you run the web app and
the collaboration server as separate services, or several collaboration
servers behind a load balancer:

- Run the same release everywhere. While versions differ, editors show
  "Aktualisierung läuft" and cannot be edited; nothing is deleted.
- Update the collaboration servers first, then the web app. A tab that
  reloads after "Neue Version" then gets the new editor from the web app and
  finds a collaboration server that accepts it.
- Each collaboration server records the newest editor version it has run with
  in the database (table `InstanceState`, columns `editorSchemaVersion` and
  `editorSchemaHash`). As soon as the first server with a newer editor has
  started, servers with an older editor disconnect their editors within
  seconds and accept no new ones. This lasts until the process is restarted
  with a current release; restarting an old release during the rollout does
  not reopen it.
- Do not skip the release that introduced this check (the first one whose
  collaboration server logs "Editor-Schema" at startup) on the way to a later
  release that changes the editor. Collaboration servers from before it do
  not know the recorded version and would keep serving old editors.
- Before a collaboration server saves a page, it takes over the state that
  another collaboration server saved in the meantime, under a lock in the
  database, so no server overwrites edits it has not seen. Collaboration
  servers from before this change overwrite the saved state instead. Update
  all collaboration servers at the same time: while old and new ones run
  side by side, an edit made on a new server can be missing from the
  database until that server saves the page again.
- Taking over the saved state has a cost that a single collaboration server
  never pays. When editors of one page are connected to different servers,
  the servers save that page in turn, so almost every save finds a state
  another server saved. It then reads that whole state from the database
  (roughly `COLLAB_MAX_DOC_MB` at most, 16 MB by default: the change that
  crosses the limit is still saved, and `0` removes the limit), decodes it
  and checks it against its editor schema, even though Redis has usually
  synchronised the content already. Each server runs at most four such
  saves at a time, and each holds the decoded state in memory while it
  runs.
- If a collaboration server finds block types or marks its editor does not
  know in the state another server saved, it checks the recorded editor
  version. A newer server records its version before it accepts editors, so
  if a newer version is recorded, the server does not take that state over,
  saves nothing for that page and accepts no editors from then on. It logs
  "Gespeicherter Stand ausserhalb des Editor-Schemas: nicht
  zusammengefuehrt, …". Otherwise the unknown elements come from a modified
  editor on a server of the same release. The server then takes them over
  like content typed on it and keeps accepting editors. It logs
  "Gespeicherter Stand ausserhalb des Editor-Schemas, Marke nicht neuer: …",
  and, as for such content typed on it, "Seiteninhalt nicht uebernommen":
  search, export and version history keep the page's last displayable
  content.

## Rolling back

Take a backup before every update, as the README describes.

- **The update did not change the editor:** go back as the README describes.
- **The update changed the editor:** go back only by restoring the backup from
  before the update (`scripts/restore.sh`). The restore brings back the
  recorded editor version of that time and makes every open tab reload.

If the older release is started on the current data instead, its
collaboration server finds a newer editor version recorded in the database.
It accepts no editors (they show "Aktualisierung läuft") and logs
"Editor-Schema dieser Instanz ist aelter als die Marke in der Datenbank".
Nothing is deleted. Update again, or restore the backup. Do not lower the
recorded version by hand: the older editor would then delete the newer
content from every page that is opened.

## Stored page content

The collaboration server checks page content against its editor schema before
it stores it as the page content that search, export, share links, printing
and page history use.

- Content the editor cannot display (an unknown block type or mark, or an
  attribute value the editor rejects) stays in the shared document, but the
  stored page content keeps its last displayable state. The error line names
  the types.
- Unknown attributes and structural deviations, such as an empty list, are
  stored as before, with a warning at most once per hour and page.

Pages written by the editor are expected to pass. To see which block and mark
types your pages use, run this read-only query:

```sh
docker compose exec -T db psql -U dokunc -d dokunc <<'SQL'
SELECT kind, type, count(DISTINCT id) AS pages FROM (
  SELECT id, 'node' AS kind,
         jsonb_path_query(content, 'lax $.**.content[*].type') #>> '{}' AS type
    FROM "Page" WHERE content IS NOT NULL AND "deletedAt" IS NULL
  UNION ALL
  SELECT id, 'mark',
         jsonb_path_query(content, 'lax $.**.marks[*].type') #>> '{}'
    FROM "Page" WHERE content IS NOT NULL AND "deletedAt" IS NULL
) t GROUP BY kind, type ORDER BY kind, type;
SQL
```

## Log lines

These collaboration server messages stay stable, so a log pipeline can count
them. The messages are German; the field names are English.

| Level | Message | Fields |
|---|---|---|
| info | `Editor-Schema` (at startup) | `schemaVersion`, `schemaHash`, `markVersion`, `markHash` |
| error | `Editor-Schema dieser Instanz ist aelter als die Marke in der Datenbank: …` (at startup) | the same |
| fatal | `Schema-Marke nicht in die Datenbank geschrieben, Start abgebrochen` | `err` |
| warn | `Neuere Editor-Fassung in der Datenbank: Verbindungen getrennt, neue werden abgewiesen` | `ownVersion`, `ownHash`, `markVersion`, `markHash`, `closed` |
| error | `Gespeicherter Stand ausserhalb des Editor-Schemas: nicht zusammengefuehrt, diese Instanz nimmt keine Editoren mehr an` | `pageId`, `unknownNodes`, `unknownMarks`, `checkError`, `markVersion`, `markHash` |
| error | `Gespeicherter Stand ausserhalb des Editor-Schemas, Marke nicht neuer: zusammengefuehrt wie Inhalt eines manipulierten Editors` | `pageId`, `unknownNodes`, `unknownMarks`, `checkError` |
| warn | `Collab-Verbindung abgewiesen` with `reason: "schema-mismatch"` (at most once per 10 seconds) | `userId`, `pageId`, `schemaTicket`, `schemaServer`, `instanceOutdated`, `sinceLast` (rejections not logged since the previous line) |
| info | `Doc-Reset uebergangen: Instanz hat eine veraltete Editor-Fassung` | `pageId` |
| error | `Seiteninhalt nicht uebernommen: Elemente ausserhalb des Editor-Schemas` | `pageId`, `editorId`, `unknownNodes`, `unknownMarks`, `checkError` |
| warn | `Seiteninhalt weicht vom Editor-Schema ab, trotzdem uebernommen` (at most once per hour and page) | `pageId`, `editorId`, `unknownAttrs`, `checkError` |

The web app answers a tab with a different editor with `409` and
`{"code":"stale-client"}` on `POST /api/collab/ticket`, without a log line.

## Development

A local collaboration server locks out its editors after you switch to a
branch with an older editor, and as soon as you change the editor schema
before its hash is registered, because the database records a newer version.
See "Editor schema" in `CONTRIBUTING.md` for how to reset it.
