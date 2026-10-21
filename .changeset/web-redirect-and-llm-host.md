---
"@n-dx/web": patch
---

The cookie-setting redirect that follows a `?ndx_token=` navigation now stays
on the dashboard's own origin. Node hands the request-target to `req.url`
unparsed, so `GET //evil.com/?ndx_token=T`, the absolute form
`GET http://evil.com/x?ndx_token=T` and `/\evil.com/` were echoed into
`Location` verbatim; a request-target that is not a plain `/path` now
redirects to `/`. Both the hub and the project server share the one fix.

The local LLM endpoints (`POST /api/llm/local-test`, `POST /api/llm/local-profiles`,
`PUT /api/llm/config` for `llm.local.host`) refuse a host or port that the
probe URL `http://${host}:${port}/v1/…` could not read back as that host and
port: a path, a query, credentials, a second port, whitespace, or a port outside
1–65535 answers 400. `GET /api/llm/local-status` and the catalog's local probe
report a saved value that fails the same check instead of fetching it. The check
is on shape only: a LAN GPU box remains a supported configuration.
