# @dokunc/config

Configuration schema shared by the web app and the collaboration server.
Both servers check their environment at startup against the declarations
in this package. When a checked value is invalid, the server logs one
`fatal` JSON line that lists every problem (`errors`) and exits with code
78. Otherwise it logs one `info` line, `Konfiguration geprueft`, with the
effective values of the checked variables (secrets masked) in `config`
and the names of the set but not yet checked variables in `unchecked`.

Only server code imports this package: `apps/web/src/instrumentation.ts`
(through `apps/web/src/lib/config`), `apps/web/src/lib/log.ts` and
`apps/collab`. Code that also runs in the Edge runtime or in the browser
imports types only (`import type { Ergebnis } from "@dokunc/config"`).

## Layout

| File | Content |
|---|---|
| `src/ergebnis.ts` | `Ergebnis<T>`, the result type of every parser |
| `src/variable.ts` | `Variable<T>`, `defineVariable()`, the parser helpers `auswahl()` and `ganzeZahl()` |
| `src/pruefen.ts` | `checkEnvironment()`: parses every variable, then runs the cross-checks, and collects all errors of one run |
| `src/maskieren.ts` | `maskValue()`, `maskedConfig()` for the startup log |
| `src/start.ts` | `checkConfigAtStartup()`, `EXIT_KONFIGURATION` (78) |
| `src/log.ts` | `LOG_LEVELS`, `logLevelFrom()` (never throws), `LOG_REDACT` |
| `src/altbestand.ts` | `NOCH_OHNE_SCHEMA`: existing variables without a declaration yet |
| `src/variablen/gemeinsam.ts` | variables read by the web app and the collaboration server |
| `src/variablen/ausserhalb.ts` | variables read only by Docker Compose, the proxy or scripts |

Variables read only by the web app are declared in
`apps/web/src/lib/config/variablen.ts`, variables read only by the
collaboration server in `apps/collab/src/config-variablen.ts`.

## Adding a variable

1. Write the parser next to the code that uses the value. It returns
   `Ergebnis<T>`: `{ ok: true, wert, hinweise? }` or `{ ok: false, fehler }`.
   Messages are German like the other log messages and name the variable,
   the allowed values and (unless the variable is secret) the value.
2. Declare the variable with `defineVariable({ name, dienste, beschreibung,
   vorgabe, geheim, parse, querpruefung })` in the list that matches the
   services reading it (see above). Every list is sorted by `name`.
   Warnings about a single value come from the parser (`hinweise`);
   checks against other variables go into `querpruefung`, with the names
   they read in `liest`. A cross-check is skipped only when one of those
   variables has an error of its own.
3. Add a commented block to `.env.example` (German, like the rest of the
   file). For a variable of the web app or the collaboration server, also
   add `NAME: ${NAME:-}` under `services.app.environment` in
   `docker-compose.yml` (empty means the default), unless the declaration
   says `inCompose: false`.
4. If the variable already existed, remove its name from
   `NOCH_OHNE_SCHEMA`.
5. Test the parser next to it. `apps/web/src/konfiguration.test.ts`
   checks names, secrets, sorting, `.env.example` and Compose on its own.
6. Add a line to `CHANGELOG.md` under "Added"; a change in behaviour
   also needs an entry under "Upgrade notes".

Names ending in `_SECRET`, `_PASSWORD` or `_KEY`, names containing
`TOKEN`, and `DATABASE_URL`, `REDIS_URL` and `SHADOW_DATABASE_URL` must be
declared with `geheim: true`. The only exceptions are `SETUP_TOKEN_FILE`
(a path) and `TOKEN_RETENTION_DAYS` (a number).

## Tests

`pnpm --filter @dokunc/config test` runs the unit tests of this package.
The connection to the servers is tested in
`apps/web/src/instrumentation.test.ts`,
`apps/web/src/konfiguration.test.ts` and
`apps/web/test/integration/collab-konfiguration.test.ts`.
