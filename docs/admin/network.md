# Network: client addresses and rate limits

The web app and the collaboration server both need the address of the
person behind a request. This page explains how they determine it and what
to set when proxies sit in front of them.

## Client addresses

- **Where the address is used:** the per-address rate limits (sign-in,
  registration, password reset, SSO start, collaboration connections and
  attempts), the audit log (`ip`), and the list of active sessions on the
  account page.
- **How it is determined:** behind reverse proxies, the address comes from
  the `X-Forwarded-For` header. The header grows from left to right: the
  client may write anything at the left end, and each proxy appends the
  address it saw. So the app counts from the **right**:
  `TRUSTED_PROXY_HOPS` is the number of your own proxies, and the entry
  that many positions from the right is the client address. The left part
  is never trusted.
- **`TRUSTED_PROXY_HOPS=0`** (the default outside Docker Compose) means the
  app is connected directly. The web app then ignores `X-Forwarded-For`
  and has no client address at all: all per-address limits share one
  counter, and the audit log and session list show no address. The
  collaboration server uses the address of the connecting socket instead.
- **With the bundled Compose setup** Caddy is the one proxy, and
  `docker-compose.yml` sets `TRUSTED_PROXY_HOPS=1`.
- **Normal form:** both services store addresses in the same form: without
  brackets or port, in lower case, and IPv4 addresses written as IPv6
  (`::ffff:192.0.2.1`) as plain IPv4 (`192.0.2.1`).
- **Values that are not addresses:** if the entry at the counted position
  is not an IP address (for example because `TRUSTED_PROXY_HOPS` is higher
  than the real number of proxies, so the app reads what the client
  wrote), the request counts as unknown: it shares the rate-limit counter
  `unknown` with all other such requests, and the audit log records no
  address.

### Log line "Client-Adresse nicht bestimmbar"

When a request carries no usable address, both services log a warning
(level 40):

```json
{"level":40,"reason":"header_too_short","hops":2,"entries":1,"count":1,
 "hint":"…","msg":"Client-Adresse nicht bestimmbar, Anfragen zaehlen unter unknown"}
```

The first occurrence is logged at once; after that, at most one line per
reason every ten minutes, with the number of occurrences since the last
line in `count`. The web app bundles route handlers and form actions
separately, so it may write one line per bundle.

| `reason` | Meaning | What to do |
|---|---|---|
| `header_too_short` | `X-Forwarded-For` has fewer entries than `TRUSTED_PROXY_HOPS`. | Lower `TRUSTED_PROXY_HOPS` to the number of your own proxies. |
| `header_missing` | `TRUSTED_PROXY_HOPS` is above 0, but the request has no `X-Forwarded-For`. | Someone reaches the service without going through the proxy; check the port bindings. |
| `not_an_ip` | The entry at the counted position is not an IP address. | `TRUSTED_PROXY_HOPS` is probably too high: lower it. |

The collaboration server also logs "Client-Adresse vermutlich die eines
Proxys" with `reason` `hops_zero_with_header` when `TRUSTED_PROXY_HOPS` is
0 but a connection carries `X-Forwarded-For`. If a proxy sits in front of
it, every connection then counts under the proxy's address; set
`TRUSTED_PROXY_HOPS` to the number of proxies. A client that connects
directly can also send the header itself; then the line means nothing.
