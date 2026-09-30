# Contributing

## Commit messages

Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) and are written in English.

    <type>(<scope>)!: <description>

    <body>

    <footers>

| Type | Use it for |
|---|---|
| `feat` | new behaviour for users or operators |
| `fix` | bug fixes; runtime dependency updates as `fix(deps)` |
| `perf` | faster or leaner, same behaviour |
| `revert` | undoing a change: `revert: <subject of the reverted commit>` |
| `refactor` | code changes without behaviour change |
| `docs` | documentation only |
| `test` | tests only |
| `build` | Dockerfile, Compose files, package manager |
| `ci` | GitHub workflows and Dependabot |
| `chore` | everything else; development dependencies as `chore(deps-dev)` |
| `style` | formatting only |

- **Scope** (optional): lowercase letters, digits and hyphens. Common scopes: `web`, `collab`, `db`, `editor`, `mail`, `e2e`, `docker`, `deps`, `deps-dev`.
- **`!`** after the type or scope marks a breaking change: an existing installation has to act although its configuration was valid so far, or a documented interface changes incompatibly. Explain it in a `BREAKING CHANGE:` footer and under "Upgrade notes" in `CHANGELOG.md`.
- **Description:** imperative mood ("add", not "added"), no full stop at the end. The whole first line has at most 100 characters.
- **Body:** why the change was needed, what changed, and how it was verified. A new test names its counter-check: the change reverted or broken on purpose, and the failure that was seen.
- **References:** refer to GitHub issues (`Fixes #123`, `Refs #123`). Do not refer to internal plans, review rounds or finding numbers; describe what the change does.

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). A change that operators or people evaluating the project notice gets its entry in the same commit, under `## [Unreleased]`:

- **Upgrade notes:** everything that behaves differently on an existing installation after the update, such as migrations, changed defaults and new or stricter settings. Each note starts with a bold keyword and a colon and says what to do, or "Nothing to do.": `- **Mail sender:** ...`.
- **Security:** fixed vulnerabilities.
- **Added, Changed, Removed, Fixed:** as described by Keep a Changelog.

Rules for entries:

- Use only the headings that already exist under "Unreleased", and append your entries at the end of their section. Do not add headings.
- An entry is a list item (`- `); continuation lines are indented by two spaces.
- Changes that only concern contributors, such as tests, CI mechanics or this file, get no entry.
- No internal plan identifiers, stage names or finding numbers, not even in parentheses.

`.gitattributes` sets `merge=union` for `CHANGELOG.md`: when branches that each appended entries are merged or cherry-picked one after another, Git keeps the lines of both sides instead of writing conflict markers. Check the result once: every entry must still be under its heading, and none may appear twice. `apps/web/src/changelog.test.ts` checks the format.

## Pull requests

- The title has the same format as a commit subject and becomes the subject of the commit on `main`. Choose the type for the pull request as a whole.
- Tools that generate a changelog from Conventional Commits, such as release-please, build its lines from these subjects, so write the title as the line a reader of the changelog should see. No such tool is set up here yet: a pull request whose change needs an entry (see "Changelog") adds it to `CHANGELOG.md` by hand.
- The workflow "PR-Titel" checks the title whenever the pull request is opened, edited, reopened or updated. It runs the check as it is on the target branch, so a change to the check takes effect once it is merged.
- GitHub's revert button suggests `Revert "<title>"`. Rename it to `revert: <title>`.
- Dependabot titles follow these rules through `commit-message` in `.github/dependabot.yml`. Dependabot does not shorten its titles, so the length limit does not apply to them.

## Branches

    <type>/<short-description>

For example `fix/redis-reconnect` or `feat/page-labels`, with the types from the table above. Branches created by tools keep their own prefix (`dependabot/…`, `claude/…`). `release/X.Y` is reserved for maintenance releases.

## Checks

| Check | Runs on | Fails when |
|---|---|---|
| CI (`.github/workflows/ci.yml`): known vulnerabilities, secrets in the Git history (gitleaks), lint, types, unit, integration and end-to-end tests, Docker stack | pushes, pull requests, weekly | a step fails or a time limit is reached |
| CodeQL (`.github/workflows/codeql.yml`): JavaScript/TypeScript and the workflows | pull requests, pushes to `main`, weekly | the analysis fails; new alerts show in the pull request |
| PR title (`.github/workflows/pr-title.yml`) | pull requests | the title does not follow the rules above |

A newer push to a pull request cancels the CI run that is still going for its previous state; every other run completes.

**CodeQL alert.** Fix it, or dismiss it in the Security tab with a reason. Test code (`e2e/`, `apps/web/test/`, `*.test.ts`, `*.test.tsx`) is not analysed; it never runs in an installation.

**gitleaks finding.** The log of the step "Historie pruefen" names file, line, commit and fingerprint; the value itself is redacted. Treat the value as leaked: the repository is public, and the value was visible from the moment it was pushed. Revoke it first. Rewriting history does not undo the leak and is not done here. If the finding is a false positive, add its fingerprint to `.gitleaksignore`, with a comment line above it that says why. The printed fingerprint contains the commit (`<commit>:<file>:<rule>:<line>`); in a pull request that is not merged yet, use the form without the commit (`<file>:<rule>:<line>`), because a squash or rebase merge creates new commits and the fingerprint would no longer match on `main`. A `gitleaks:allow` comment on the line helps only before you push: gitleaks checks every commit in the history, so the comment has to be in the commit that adds the line. Added in a later commit, it does not clear a finding that CI has already reported.

## End-to-end tests

`pnpm test:e2e` empties the database that `DATABASE_URL` points to; only local hosts are accepted. `e2e/first-account.setup.ts` registers the first account and creates the first space with its page "Willkommen". It runs as the Playwright project `erstes-konto` before every other file, also when you run a single file; the other files log in with that account. Name a new file after the behaviour it covers, such as `trash-and-version-restore.spec.ts`.

## Editor schema

The editor's schema (the nodes, marks and attributes, with their default values, from `richExtensions()` in `packages/editor`) has a hash. The browser, the web app and the collaboration server compare it before a tab may sync, because an editor with a different schema deletes the content it does not know from the shared document. When you change the schema, `apps/web/src/lib/schema-hash.test.ts` fails. Append the new hash to `EDITOR_SCHEMA_HASHES` in `packages/editor/src/schema-version.ts` and to the copy `EINGETRAGEN` in that test; never change, remove or reorder an entry. The copy makes the test fail when an entry is replaced: installations record the version and hash they ran, and a collaboration server with a replaced hash would count as outdated there and accept no editors. Add an upgrade note that open editor tabs must be reloaded after the update.

- A new node or attribute always goes into `richExtensions()`. A setting may hide it in the interface, but it must not change the schema: the web app and the collaboration server would then run different schemas depending on their environment.
- Removing or renaming a node, mark or attribute needs a migration of the stored Yjs documents first. A newer editor drops what it does not know, just like an older one.

Every collaboration server records the highest schema version it has started with in the database (`InstanceState`). A server with an older schema accepts no editors: they show "Aktualisierung läuft", and the server logs "Editor-Schema dieser Instanz ist aelter als die Marke in der Datenbank". In your development database, reset the mark and restart the collaboration server:

    UPDATE "InstanceState" SET "editorSchemaVersion" = 0;

You need this in two cases:

- **You change the schema.** Until its hash is in `EDITOR_SCHEMA_HASHES`, your schema has version 0, which is older than any recorded version, so your local server locks out its editors right away. Reset once; at version 0 the server ignores the recorded hash, so further changes need no reset. Append the hash when the change is final; the server then records the new version. If you change the schema again after that, reset again and append another hash when you are done, instead of replacing the one you appended.
- **You switch to a branch with an older schema.**

## What is not rewritten

Published Git history and applied database migrations stay as they are. Prisma stores a checksum of every applied migration: changing one, even a comment, makes `prisma migrate dev` ask to reset existing development databases, and a renamed migration directory would run again on every installation. Commits and migrations from before these rules therefore keep their German subjects and internal numbering; `apps/web/src/konventionen.test.ts` lists those migrations by name and checks every other tracked file and path for internal plan references.

## Maintainers

These rules rely on repository settings that are not stored in the repository:

- **Merging:** "Allow merge commits" with the default commit message "Pull request title", so the subject on `main` is the checked title. Rebase merging is off. Squash merging is off, or its default commit message is "Pull request title"; otherwise a pull request with a single commit lands with that commit's subject.
- **Required checks:** a ruleset for `main` requires the checks above once each of them has passed with its workflow on `main`: CI and CodeQL on `main` itself, the PR title check on the first pull request after `pr-title.yml` is on `main`, since it runs only on pull requests.
- **Secret scanning:** "Secret Protection" and its push protection are on for the repository (Settings → Advanced Security). Push protection blocks known token formats before they land; gitleaks in CI covers the history and generic secrets.
- **Code scanning:** CodeQL "Default setup" stays off; while it is on, GitHub rejects the results of `codeql.yml`. The CodeQL checks become required only after the alerts of the first analysis of `main` have been triaged.
