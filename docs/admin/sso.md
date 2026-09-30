# Single sign-on (OIDC)

dokunc signs people in through an OpenID Connect provider (authorization code
flow with PKCE) when `OIDC_ISSUER` and `OIDC_CLIENT_ID` are set. This page
describes the settings, how dokunc decides that an email address is verified,
and the setup for Microsoft Entra ID, Google, Keycloak and authentik. All
settings are environment variables in `.env`; restart the app after a change.
Invalid values stop the start with an error that names the variable.

## Basics

| Variable | Default | Meaning |
|---|---|---|
| `OIDC_ISSUER` | empty (SSO off) | Issuer URL of the provider. `https` is required, except for `localhost`. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | empty | Client registered at the provider. Leave the secret empty for a public client; PKCE is always used. |
| `OIDC_SCOPES` | `openid email profile` | Scopes requested at sign-in. |
| `OIDC_BUTTON_LABEL` | `Single Sign-on` | Text of the button on the sign-in page ("Weiter mit …"). |
| `OIDC_ALLOW_SIGNUP` | `false` | `true` lets the provider create accounts for people without one. Otherwise only people who already have an account (by invitation) sign in. |
| `OIDC_AUTO_LINK_BY_EMAIL` | `true` | Links an existing account to the provider on the first SSO sign-in, if the provider's address is verified. Accounts with admin rights are never linked automatically. |
| `OIDC_TRUSTED_EMAIL_DOMAINS` | empty | See "How dokunc decides that an address is verified". |
| `OIDC_EMAIL_CLAIM` | `email` | Claims that carry the email address, in order. |
| `OIDC_NAME_CLAIM` | `name` | Claim for the display name; then `name`, then `preferred_username`. |
| `OIDC_SUBJECT_CLAIM` | `sub` | Claim that identifies a person permanently: `sub` or `oid`. |
| `SSO_ENFORCEMENT` | `linked_accounts` | See "Password sign-in for accounts linked to SSO". |

Register this redirect URI at the provider:

```
<APP_URL>/api/auth/oidc/callback
```

An account is bound to the provider by the issuer and the subject claim, not
by the email address: addresses can be reassigned in a directory, the subject
cannot. The address matters only when an account is linked or created.

## How dokunc decides that an address is verified

A verified address may link an existing account (with
`OIDC_AUTO_LINK_BY_EMAIL=true`) or create one (with `OIDC_ALLOW_SIGNUP=true`).
An unverified address can do neither; the person sees "Der Anbieter bestätigt
diese E-Mail-Adresse nicht."

For the address from the `email` claim, the first matching row decides:

| The provider sends | Result | Recorded as |
|---|---|---|
| `email_verified: true` | verified | `email_verified` |
| `email_verified: false` (or the text `"false"`) | not verified, whatever the domain | – |
| `xms_edov: true` (Microsoft Entra ID) | verified | `xms_edov` |
| `xms_edov: false` (or the text `"false"`) | not verified, whatever the domain | – |
| neither claim (or another value, such as the text `"true"`) | verified only if the domain is in `OIDC_TRUSTED_EMAIL_DOMAINS` and the token does not come from a guest (see below) | `domain` |

- **`OIDC_TRUSTED_EMAIL_DOMAINS`:** domains separated by commas or spaces, at
  most 100. Subdomains are listed one by one; there are no wildcards.
  International domain names are compared in their punycode form.
- **`OIDC_EMAIL_CLAIM`:** up to five claims, separated by commas, for example
  `email,preferred_username`. The first claim that holds an address decides.
  The `email` claim always counts, verified or not, and ends the search: an
  address the provider names is never replaced by another claim. Any other
  claim (`preferred_username`, `upn`, your own) counts only for an address in
  `OIDC_TRUSTED_EMAIL_DOMAINS` and is skipped otherwise. Such an address
  counts as verified through the domain.
- **Userinfo:** when the ID token holds no address, or an address from
  `email` without `email_verified` and without `xms_edov`, dokunc also asks
  the provider's userinfo endpoint. Its answer is used only if its `sub`
  equals the `sub` of the ID token. The ID token wins for every claim it
  carries; missing claims (address, `email_verified`, name) come from
  userinfo. Signed userinfo responses (`application/jwt`) are not supported.
  If the endpoint fails, dokunc logs "OIDC-Userinfo abgelehnt",
  "OIDC-Userinfo nicht als JSON", "OIDC-Userinfo gehört zu einem anderen
  Subject — verworfen" or "OIDC-Userinfo nicht erreichbar" and continues with
  the ID token alone.
- **Guests from another directory:** Microsoft Entra ID names a guest's home
  tenant in the claim `idp`. When `idp` is present and differs from the
  issuer, the domain rule does not apply, neither to `email` nor to other
  claims. A guest's address is then verified only through `email_verified` or
  `xms_edov`.
- **Audit log:** `auth.sso_linked` and `auth.registered` record the claim the
  address came from (`emailSource`) and what verified it (`verifiedBy`).
  Refused sign-ins are recorded as `auth.login_failed` with the reason, for
  example `unverified`.

## Warning: account takeover (nOAuth)

A verified address can take over an existing account. Get these settings
wrong and someone else signs in as one of your people:

- Never list domains in `OIDC_TRUSTED_EMAIL_DOMAINS` that your organisation
  does not control. Never list public mail domains such as `gmail.com` or
  `outlook.com`; the startup log warns about the common ones.
- Never add `preferred_username`, `upn` or another claim to
  `OIDC_EMAIL_CLAIM` for a provider where people choose that value
  themselves, for example Keycloak or authentik with self-registration.
- With a multi-tenant app and the `email` claim, any Entra ID tenant could
  claim any address. dokunc therefore accepts only the issuer of a single
  tenant.
- If addresses in your directory can be reassigned (successors, aliases,
  people who left), set `OIDC_AUTO_LINK_BY_EMAIL=false`. Otherwise the new
  holder of an address takes over the old account on the first sign-in.

## Microsoft Entra ID

1. **App registration:** platform "Web", redirect URI as above, and a client
   secret. Supported account types: "Accounts in this organizational
   directory only".
2. **Token configuration:** add the optional claims `email` and `xms_edov` to
   the ID token. Without `xms_edov`, only `OIDC_TRUSTED_EMAIL_DOMAINS`
   verifies addresses, and dokunc logs once per process "Entra ID schickt
   weder xms_edov noch email_verified".
3. **Settings:** `OIDC_CLIENT_ID` is the application (client) ID,
   `OIDC_CLIENT_SECRET` the secret from step 1, and

   ```
   OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
   OIDC_SUBJECT_CLAIM=oid
   OIDC_TRUSTED_EMAIL_DOMAINS=<your verified domains>
   ```

   For accounts without a mailbox, which have no `email` claim, add
   `OIDC_EMAIL_CLAIM=email,preferred_username`: their user principal name
   then counts as the address if it is on one of your trusted domains.
4. **Issuer:** only the issuer of your tenant works. `common`,
   `organizations` and `consumers` stop the sign-in with the log line
   "OIDC_ISSUER zeigt auf einen Multi-Tenant-Endpunkt von Microsoft".
5. **`oid` instead of `sub`:** Entra ID's `sub` differs for every app
   registration, the object ID `oid` does not. dokunc accepts only a GUID in
   `oid`. Entra ID sends `oid` only with the scope `profile`, which the
   default `OIDC_SCOPES` contain; the startup log warns if it is missing.

### Checking a real tenant

The automated tests use a test provider with Entra ID's documented claim
formats. After setting up a real tenant, and before each release, check
once:

- A member with a mailbox signs in; the audit entry `auth.sso_linked` or
  `auth.registered` shows `verifiedBy: "xms_edov"` (a boolean `true` in the
  token; any other form falls back to the domain rule).
- An account without a mailbox signs in with
  `OIDC_EMAIL_CLAIM=email,preferred_username`.
- A guest from another tenant: the ID token carries `idp`, and the sign-in
  with an address on one of your domains is refused unless `xms_edov` is
  `true`.
- The userinfo endpoint returns the same `sub` as the ID token (otherwise
  the log shows "OIDC-Userinfo gehört zu einem anderen Subject").

## Google

```
OIDC_ISSUER=https://accounts.google.com
```

Google sends `email_verified`; the other settings keep their defaults.

## Keycloak

```
OIDC_ISSUER=https://<host>/realms/<realm>
```

Keycloak always sends `email_verified`, so `OIDC_TRUSTED_EMAIL_DOMAINS` only
matters for further claims in `OIDC_EMAIL_CLAIM`. Add `preferred_username`
there only if people cannot register themselves or change their user name.

## authentik

```
OIDC_ISSUER=https://<host>/application/o/<slug>/
```

The trailing slash is removed before the issuer is compared. Check what your
`email` scope mapping returns for `email_verified`: the default mapping may
report every address as verified without checking it. Then any address a
person enters in authentik can link an existing account; set
`OIDC_AUTO_LINK_BY_EMAIL=false` or map `email_verified` to the real state.

## Password sign-in for accounts linked to SSO

An account is linked to single sign-on as soon as it has a subject from a
provider: created through SSO, or linked on its first SSO sign-in. With
`SSO_ENFORCEMENT=linked_accounts` (the default, also on existing
installations), such an account:

- cannot sign in with a password. The sign-in form answers "Falsche
  Zugangsdaten", as for a wrong password, even when the password is right;
  the audit log records `auth.login_failed` with the reason `sso_required`
  (only for a right password; a wrong one is `bad_credentials`). When a
  provider is configured, the form adds a line that accounts linked to it
  sign in with "Weiter mit …". That line appears for every failed sign-in,
  so it does not tell whether an account is linked.
- gets no reset link from "Passwort vergessen". The confirmation is the same
  for every address and, when a provider is configured, names it. The audit
  log records `auth.login_failed` with `sso_required` and
  `via: "reset_request"`.
- cannot use a reset link issued before it was linked. The link is voided,
  and the page names the provider.

This holds for every linked account, whatever issuer it is linked to and
whether SSO is configured at all: a broken or removed SSO configuration
must not open the password path again. Deactivated accounts get no reset
link either, and links issued before the deactivation no longer work
(`inactive`).

**The way back is `SSO_ENFORCEMENT=off`** (restart required): linked
accounts then sign in and reset their password like all others. Use it
while your provider is down, after switching to another provider, or after
turning SSO off; set it back afterwards.

- Keep one local admin account with a password. Admin accounts are never
  linked automatically, so create the first account with a password.
- Self-service actions that ask for the current password (change password,
  delete account, turn off two-factor authentication, new recovery codes)
  are not available to linked accounts that never set a password. Admins
  can delete such accounts and reset their two-factor authentication in
  the admin area.
- A person you block at the provider keeps the sessions they already have
  until those expire.

## Changing `OIDC_SUBJECT_CLAIM`

When you switch from `sub` to `oid`, existing bindings move on each person's
next sign-in: dokunc finds the account by its old `sub` from the same issuer,
stores the `oid` instead and records `auth.sso_linked` with
`subjectClaim: "oid"` and `previousClaim: "sub"`. Deactivated accounts do not
move.

There is no automatic way back. Before you switch back to `sub`, or roll back
to a version from before this setting, clear the bindings of the issuer:

```sql
UPDATE "User" SET "oidcSubject" = NULL, "oidcIssuer" = NULL
WHERE "oidcIssuer" = '<OIDC_ISSUER>';
```

The next sign-in links the accounts again by email address, if
`OIDC_AUTO_LINK_BY_EMAIL=true`, the address is verified and the account has
no admin rights.
