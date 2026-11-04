---
id: "9d5af533-0705-482b-bc9f-031f9460bd9c"
type: "task"
title: "The hub session opens from the hub home with per-user auth on"
slug: "the-hub-session-opens-from-the-hub"
description: "Found restacking H1 on main 768e83cf2, whose auth (2b16b07f0) sends every browser navigation the deferred hub home shell and keeps credentials in headers only. With auth on (the default): the shell never gets hubSession, so the Hub session toggle never shows; the drawer iframe's navigation to /hub/session/drawer carries no credential and handlePublicHubRequest refuses it (401); and the host serves hub-session.html without injectSessionScript, so the drawer's fetches would carry no credential either. The merge already forwards the per-user token from the hub to the host and opens the drawer socket through openWebSocket. See docs/architecture/web-server.md, Authentication and Hub session."
acceptanceCriteria:
  - "With auth on, the deferred hub home shows the Hub session toggle once its script has signed in, exactly when probeHubLens says the host can run the hub lens; the shell's markup still names no project, path or count"
  - "A credential-less GET navigation (Accept: text/html) to /hub/session/drawer answers 200 with the drawer page, fetched from the host with the per-user token; the page holds no session data, only the static paths config"
  - "Every other credential-less /hub/session/ request (any API path, any non-GET, an upgrade without a ticket) is still refused 401 and forwards nothing to the host"
  - "The host serves the drawer page with injectSessionScript, so the drawer's fetches carry the session credential and its WebSocket carries a ticket"
  - "Tests cover the deferred toggle, the public drawer page and the refusals above; the authenticated (non-deferred) home still renders the toggle as before"
priority: "high"
source: "merge-review"
---
