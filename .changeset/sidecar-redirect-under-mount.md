---
"@n-dx/web": patch
---

A sidecar redirect to a path already under `/x/<name>/`, built from `X-Ndx-Base-Path`, is forwarded unchanged instead of being prefixed twice. So is a redirect to the bare mount with a query or fragment (`/x/<name>?tab=2`, `/x/<name>#a`).
