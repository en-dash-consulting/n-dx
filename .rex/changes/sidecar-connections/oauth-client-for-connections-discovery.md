---
id: "56b4e856-c20b-4811-9a4e-ca08a85c2dff"
type: "task"
title: "OAuth client for connections: discovery, PKCE, token storage and silent refresh"
slug: "oauth-client-for-connections-discovery"
description: "Story 49, part 1 (CAOS 3f7a80b7-1924-81a3-98e1-cb38f63618a8). Implement the SDK's OAuthClientProvider (@modelcontextprotocol/sdk/client/auth.js) in packages/web/src/server/connections/oauth-provider.ts for auth \"oauth\" connections, using the SDK's own discovery (protected-resource and authorization-server metadata), dynamic client registration, authorization code + PKCE (S256) and refresh. Persist client information and tokens as one JSON value in connection:<id> (through connection-credentials.ts), bound to the connection's URL: if the configured URL no longer matches the stored one, the tokens are not sent and the connection reads needs-sign-in. Code verifier and state are held in memory only, single-use, expiring after 10 minutes. On an expired access token, refresh silently; before refreshing, re-read the store (another process may have rotated it) and on a refresh failure re-read and retry once before declaring needs-sign-in. A revoked or rejected refresh token clears the tokens (keeps the client registration) and the connection reads needs-sign-in ('sign in again'). Expose beginSignIn(connection, redirectUrl) -> authorization URL, finishSignIn(connection, code, state), and signOut(connection). No browser is ever opened by the server: headless callers (the hub's automation in C2) get needs-sign-in. Follow the shared rules in the parent change's description (config only in .n-dx.local.json, tokens only from connection:<id> via connection-credentials.ts, no child env token, nothing tracker-specific, fake servers and a temp ndx home in tests, no AGENTS.md edits under packages/web, nothing turns on web.sidecar)."
acceptanceCriteria:
  - "Against a fake authorization server and fake MCP server: beginSignIn returns an authorization URL with S256 PKCE and a state; finishSignIn with the right state stores tokens in connection:<id> of a temp-home store and the connection's tools list (test)"
  - "A wrong, reused or expired state is refused and stores nothing (test)"
  - "An expired access token is refreshed silently and the call succeeds with no sign-in; a revoked refresh token leaves the connection needs-sign-in with reason 'sign in again' (tests)"
  - "Tokens bound to one URL are not sent to a connection whose configured URL changed (test)"
  - "No token or code appears in a log line, API response, project file or child env (test greps captured output and the temp project dir)"
  - "A headless call with no browser (the path the hub uses) refreshes and succeeds, and with no valid refresh token returns needs-sign-in without blocking (test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
