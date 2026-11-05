---
id: "98f4d418-79b5-4c39-bcbd-aa5b91aa5e36"
type: "task"
title: "Sign-in flow returns to the dashboard, and Settings lists connections with their state"
slug: "sign-in-flow-returns-to-the-dashboard"
description: "Story 49, part 2. Authenticated routes on the project server: GET /api/connections (id, label, transport, auth, state, reason, tool count; never a token or fingerprint beyond credentialFingerprint), POST /api/connections/:id/oauth/start -> { authorizationUrl }, POST /api/connections/:id/oauth/finish { code, state }, POST /api/connections/:id/sign-out. The OAuth redirect URI is a dashboard page under the dashboard's own origin and base path (the page shell is already public; no new public API route and no credential in a URL the server reads): the page reads code and state from its query, POSTs them with its session credential in the header to /oauth/finish, removes them from the address bar, and returns to Settings > Connections showing the result. This works through the hub (/p/<id>/) and on a direct project server; follow docs/architecture/web-server.md#authentication and the hub's request-guard. Add a minimal read-only Connections section to Settings > Project (packages/web/src/viewer/views/domain-settings.ts / components/settings-frame.ts): each connection's label, transport, state ('connected', 'connection unavailable: …', 'sign in again'), Sign in / Sign out for oauth connections, and a line naming .n-dx.local.json as where connections are added until story 47. Only shown while web.sidecar is on. Check dark and light themes. Follow the shared rules in the parent change's description (config only in .n-dx.local.json, tokens only from connection:<id> via connection-credentials.ts, no child env token, nothing tracker-specific, fake servers and a temp ndx home in tests, no AGENTS.md edits under packages/web, nothing turns on web.sidecar)."
acceptanceCriteria:
  - "The connections and oauth routes refuse a request without the per-user token or a browser session, and no new route is public (route-gate tests, including through the hub proxy)"
  - "Start then finish against the fake authorization server stores tokens and the connection reads connected; the redirect page clears code and state from the URL (tests)"
  - "GET /api/connections never returns a token, refresh token or code (test asserts on the JSON)"
  - "Settings > Project shows a Connections section only while web.sidecar is on, with state and Sign in / Sign out per oauth connection (viewer test)"
  - "A connection whose refresh was revoked shows 'sign in again' in Settings (viewer test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
