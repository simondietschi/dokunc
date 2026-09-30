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
| `header_too_short` | `X-Forwarded-For` has fewer entries than `TRUSTED_PROXY_HOPS`. | With the bundled Caddy and a proxy in front of it: list that proxy in `TRUSTED_PROXIES` (see "Proxy chain"). Otherwise lower `TRUSTED_PROXY_HOPS` to the number of your own proxies. A single occurrence can also be a request that bypassed the upstream proxy. |
| `header_missing` | `TRUSTED_PROXY_HOPS` is above 0, but the request has no `X-Forwarded-For`. | Someone reaches the service without going through the proxy; check the port bindings. |
| `not_an_ip` | The entry at the counted position is not an IP address. | `TRUSTED_PROXY_HOPS` is probably too high: lower it. |

A second warning, "Client-Adresse vermutlich die eines Proxys", means that
requests do get an address, but probably the wrong one:

| `reason` | Meaning | What to do |
|---|---|---|
| `address_is_proxy` | The address found is listed in `TRUSTED_PROXIES`, so it belongs to an upstream proxy. Everybody behind that proxy shares its address. | Raise `TRUSTED_PROXY_HOPS`: 1 for the bundled Caddy plus 1 for each proxy in front of it. |
| `hops_zero_with_header` | Collaboration server only: `TRUSTED_PROXY_HOPS` is 0, but a connection carries `X-Forwarded-For`. | If a proxy sits in front of the server, every connection counts under the proxy's address; set `TRUSTED_PROXY_HOPS` to the number of proxies. A client that connects directly can also send the header itself; then the line means nothing. |

At startup, the web app also warns when it runs with `NODE_ENV=production`
and `TRUSTED_PROXY_HOPS=0` ("TRUSTED_PROXY_HOPS ist 0: keine
Client-Adressen"), and both servers warn when `TRUSTED_PROXIES` is set but
`TRUSTED_PROXY_HOPS` is below 2. An invalid `TRUSTED_PROXY_HOPS` (anything
but a whole number from 0 to 10) or `TRUSTED_PROXIES` stops the start with
exit code 78 and a log line that names the variable.

## Proxy chain

This section is about a load balancer, WAF or CDN **in front of the bundled
Caddy**.

### What Caddy does with `X-Forwarded-For`

- From the addresses in `TRUSTED_PROXIES`, Caddy keeps `X-Forwarded-For`
  and appends the address it saw (the upstream proxy's own address).
- From everybody else, Caddy discards the header and sets it to the address
  it saw. A client that connects directly can therefore not choose its
  address.
- From trusted proxies, Caddy also passes `X-Forwarded-Proto` and
  `X-Forwarded-Host` on unchanged. The app uses `X-Forwarded-Proto` to pick
  `wss://` or `ws://` for the editor connection, and form actions compare
  the browser's `Origin` with `X-Forwarded-Host` (or `Host`). The upstream
  proxy must therefore send `X-Forwarded-Proto: https` and either keep the
  `Host` header or set `X-Forwarded-Host` to the public name, and `APP_URL`
  must be the public address.
- `{client_ip}` in Caddy's own logs and matchers is counted from the right
  as well (`trusted_proxies_strict`).

### Settings

1. Set `TRUSTED_PROXIES` in `.env` to the addresses of the upstream proxies
   themselves: IP addresses or CIDR ranges, **separated by spaces**, for
   example `TRUSTED_PROXIES="10.0.0.5 10.0.0.6"`. A comma stops Caddy; the
   app checks the format at startup and refuses to start with a readable
   message instead. `private_ranges` stands for all private networks.
2. Set `TRUSTED_PROXY_HOPS` to 1 (Caddy) plus the number of proxies in
   front of Caddy: `2` for one load balancer.
3. Make sure the upstream proxy **appends** to `X-Forwarded-For` instead of
   replacing it or leaving it out: nginx
   `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, HAProxy
   `option forwardfor`, Traefik and most cloud load balancers do it by
   default.
4. Restart: `docker compose up -d`.

**Never list client networks** in `TRUSTED_PROXIES`, and do not use
`private_ranges` if clients in a private network can reach Caddy directly:
whoever is listed can claim any client address, and with it a fresh
rate-limit counter for every request.

### Checking the result

- The audit log (admin area) and the session list on the account page show
  the addresses of the people, not the load balancer's.
- `docker compose logs app | grep Client-Adresse` shows neither of the two
  warnings above. After a change, give it a few requests.

### Proxy on the same host

When nginx, Apache or another proxy runs on the Docker host itself and
forwards to `https://127.0.0.1:7891` (the default `APP_BIND`), Caddy does
**not** see `127.0.0.1`. Docker hands such connections over from the
gateway address of the Compose network `edge`, for example `172.19.0.1`:

```sh
docker network inspect "$(docker compose config --format json | jq -r .name)_edge" \
  --format '{{(index .IPAM.Config 0).Gateway}}'
```

List that gateway address in `TRUSTED_PROXIES`. The network `edge` has no
fixed subnet, so the address can change when the network is created anew
(`docker compose down` and `up`). To fix it, give `edge` a subnet in your
own `docker-compose.override.yml`:

```yaml
networks:
  edge:
    ipam:
      config:
        - subnet: 172.30.250.0/24
```

The gateway is then `172.30.250.1`. Keep `APP_BIND=127.0.0.1` in this
setup.

**Warning:** every connection that Docker hands over from the host carries
the gateway address, not only those of your proxy: other processes on the
host, and possibly clients of the published port. In particular, with
`docker-compose.ipv6.yml` the network `edge` has no IPv6, so connections to
the published IPv6 port are probably relayed by `docker-proxy` and then all
carry the gateway address as well (not verified). Listing the gateway in
`TRUSTED_PROXIES` would then let every such client choose its own address.
Only list the gateway when nothing but your own proxy can reach the
published port.

### Load balancer that forwards TCP (layer 4)

A load balancer that passes TLS through to Caddy (so that Caddy can obtain
its own certificates) cannot add `X-Forwarded-For`, and Caddy sees only the
load balancer's address. Two ways out:

- Use the PROXY protocol, if the load balancer supports it. Caddy then
  needs a listener wrapper in the global `servers` block of the
  `Caddyfile`, for example:

  ```
  servers {
  	listener_wrappers {
  		proxy_protocol {
  			allow 10.0.0.5/32
  		}
  		tls
  	}
  	trusted_proxies static {$TRUSTED_PROXIES}
  	trusted_proxies_strict
  }
  ```

  Caddy then sees the client address directly: keep `TRUSTED_PROXY_HOPS=1`
  and leave `TRUSTED_PROXIES` empty. This changes a versioned file; merge
  it again after updates.
- Or use a load balancer mode that keeps the client address (transparent
  or direct server return).

### Without the bundled Caddy

Set `TRUSTED_PROXY_HOPS` to the number of your own proxies that append to
`X-Forwarded-For`, counted from the app outwards. The outermost of them
must not keep a header the client sent in a way that shifts the count:
appending is fine, because the app counts from the right. `TRUSTED_PROXIES`
is only read by the bundled Caddy; the app uses it only for the warnings
above.

## Rate limit settings

The web app limits sign-in, registration, password reset and single
sign-on per client address, and file uploads per account. These limits
can be set in `.env`; all others
(per account, per email address, two-factor codes, password confirmation)
are fixed on purpose, because many people behind one address do not
affect them.

| Variable | Default | Counts |
|---|---|---|
| `RATE_LIMIT_LOGIN_PER_IP` | `30/5m` | password sign-in attempts per address (the limit of 8 per 15 minutes per account stays) |
| `RATE_LIMIT_REGISTER_PER_IP` | `10/10m` | registrations per address |
| `RATE_LIMIT_RESET_REQUEST_PER_IP` | `5/15m` | password reset requests per address (the limit of 3 per hour per email address stays) |
| `RATE_LIMIT_RESET_SUBMIT_PER_IP` | `10/15m` | new passwords set through a reset link, per address |
| `RATE_LIMIT_SSO_START_PER_IP` | `600/1h` | single sign-on starts per address |
| `RATE_LIMIT_UPLOAD_PER_USER` | `30/1m` | file uploads per **account** (not per address: uploads need a signed-in account, and what fills the disk is the account) |

- **Format:** `<attempts>/<window>`, for example `30/5m`. The window is in
  seconds, or with the unit `s`, `m` or `h`; at most `24h`. Attempts from 1
  to 100000. Empty means the default. An invalid value stops the start
  with a log line that names the variable.
- **Same value on every instance:** the counters live in Redis and are
  shared; with different values, each instance applies its own limit to
  the shared counter.
- The limits apply per address as the app sees it (see "Client
  addresses"). If the address cannot be determined, all such requests
  share the counter `unknown`, and the limits hit everybody at once.
