---
"@n-dx/web": patch
"@n-dx/graview-face": patch
---

Hub-mounted extensions open in a browser again when the per-user token is on. A navigation to `/x/<name>/` without a credential gets the hub's own sign-in page, which asks `POST /api/hub/mounts/<name>` for a keyed mount (`/x/<name>/~<key>/`) and moves there; the key in the path admits that one sidecar's pages, scripts, styles, mutations and WebSockets, and nothing else. Extension pages never get the hub's session script. The keyed mount is announced in `X-Ndx-Base-Path` and, at launch, `NDX_BASE_PATH`, which graview-face now uses as its base. The preview server's sign-in page also parses again: a regex in its script had lost its backslash to the template literal.
