# First account and setup token

The first account of an instance becomes instance admin. Until it exists,
anyone who reaches the instance could create it. dokunc therefore protects
this first step with a one-time setup token.

## How it works

- As long as the instance has no account, the web app writes a random token
  to a file when it starts, and again when the sign-in or registration page
  is opened and the file is missing. In the Docker image the file is
  `/app/data/setup_token` on the volume `app_data`, readable only by the app
  (mode 600). Outside Docker, set `SETUP_TOKEN_FILE` to a writable absolute
  path.
- The token is printed once, when the file is created, in the log line
  "Ersteinrichtung offen: Das erste Konto braucht dieses
  Einrichtungs-Token" (field `setupToken`), whatever `LOG_LEVEL` says.
  Later starts only log "Ersteinrichtung offen: Einrichtungs-Token liegt in
  der Datei".
- The first account needs the token, for a password registration and for
  the first sign-in through single sign-on. Without it, or with a wrong one,
  the registration is refused and recorded as `auth.login_failed` with the
  reason `setup_token`.
- **No token is needed only on the machine itself:** `APP_URL` is set and
  points to `localhost` (or `127.0.0.1`, `[::1]`, a name under
  `.localhost`), and the request also arrives with such a host name. This is
  the case for the Docker quick start at `https://localhost:7891` and for
  development. Without `APP_URL`, or with your own domain, the token is
  needed.
- When the first account exists, the file is deleted, and
  `auth.first_admin_created` is recorded in the audit log, with
  `setupToken: "required"` or `"not_required"`. After that, new accounts
  only come through invitations (or single sign-on with
  `OIDC_ALLOW_SIGNUP=true`), as before.
- Two first registrations at the same moment cannot both become admin: the
  first account is created under a database lock.

## Setting up an instance with its own domain

**Before you open the site**, read the token on the server:

```bash
docker compose exec app cat /app/data/setup_token
```

It is also in `docker compose logs app` from the first start. Then open
`/register`, fill in name, email, password and the token. The account
becomes instance admin.

For single sign-on, open the sign-in page instead: while there is no
account, it shows a field for the token next to the provider button
("Erstes Konto über … anlegen"). The token is checked before you are sent
to the provider and is bound to that one sign-in; the account is created
when you come back, as instance admin, and only if the provider confirms
the email address (see `docs/admin/sso.md`). Creating the first account with
a password is still recommended: admin accounts are never linked to single
sign-on automatically, and a local admin with a password keeps working when
the provider is down.

## If something goes wrong

- **"Die Ersteinrichtung ist gesperrt, weil das Einrichtungs-Token nicht
  angelegt werden konnte"**: the app could not write the file. The log line
  "Einrichtungs-Token konnte nicht angelegt werden" names the path and the
  error. Fix the permission, or set `SETUP_TOKEN_FILE` to a writable path,
  and reload the page.
- **The token is lost:** delete the file and restart the app (or open the
  sign-in page); a new token is written and printed.
- **An empty database volume** puts the instance back into setup mode: the
  app writes a new token.
- **A leftover `setup_token` file** after the first account has no effect;
  the app removes it at the next start.

## Remaining risk

The exception for the machine itself relies on the host name of the
request. If the proxy accepts connections from outside (`APP_BIND=0.0.0.0`)
while `SITE_ADDRESS` and `APP_URL` are still `localhost`, a request with the
host name `localhost` from outside needs no token. Set `SITE_ADDRESS` and
`APP_URL` to your domain before you open the port.

## Checking the setup form by hand

The automated tests cover both paths and a wrong token against the server,
but not the form in a browser for the first account through single sign-on.
When you change the sign-in page, check once on an empty instance with your
own domain and a provider: the sign-in page shows the token field, a wrong
token shows an error, and the right one leads to the provider and back to
`/spaces` with the new admin account.
