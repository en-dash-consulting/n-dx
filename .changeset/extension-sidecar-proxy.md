---
"@n-dx/core": patch
"@n-dx/web": patch
"@n-dx/llm-client": patch
---

The hub's `/x/<name>/` proxy now keeps the per-user token away from extension sidecars: the `X-Ndx-Token` header, the `ndx_token` cookie and a bearer carrying the token are removed from forwarded HTTP and WebSocket requests, and `X-Ndx-Base-Path: /x/<name>/` is added. The bare `/x/<name>` redirects to `/x/<name>/`. A disabled or unapproved extension answers 404 with the reason, as an unknown one does. `x` is reserved as a project id: the hub refuses to register it, and a repository named `x` gets a hashed id.

The proxy strips the hub token from query parameters as well as headers and cookies, preserves redirects already under the mount, and replaces client-supplied sidecar credentials. Each hub launch uses a separate random NDX_SIDECAR_SECRET checked by the sidecar on HTTP, health and WebSocket requests. Running sidecars revalidate approval, stop on revocation even with open sockets, and exit when the hub lifetime pipe closes. The hub accounts for cold-request disconnects, stopped-instance connections, health-port races and crash backoff.
