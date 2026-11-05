---
id: "c9daa465-9425-4a3a-b358-80d6033bf588"
type: "change"
title: "OAuth connections sign in with n-dx's client ID metadata document"
slug: "oauth-connections-sign-in-with-n-dx-s"
intent: "A live sign-in to CAOS (2026-11-05) failed: \"Could not start the sign-in: Incompatible auth server: does not support dynamic client registration\". CAOS's authorization server (https://caos.endash.us/.well-known/oauth-authorization-server) has no registration_endpoint and advertises client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported [none], S256 PKCE, authorization_code + refresh_token. The connection OAuth (packages/web/src/server/connections/oauth-provider.ts, task 56b4e856) assumed dynamic client registration (decision 5, C1). The MCP SDK 1.32.1 already supports Client ID Metadata Documents through OAuthClientProvider.clientMetadataUrl: when the server advertises support, the SDK sends that HTTPS URL as client_id instead of registering. n-dx's document is published by PR #969 at https://docs.n-dx.dev/oauth/client.json with redirect_uris http://127.0.0.1/oauth/callback and http://localhost/oauth/callback (loopback, any port per RFC 8252)."
acceptanceCriteria:
  - "An OAuth connection to an authorization server that supports client ID metadata documents and has no registration endpoint signs in with client_id https://docs.n-dx.dev/oauth/client.json and the fixed loopback callback, end to end against a fake authorization server (test, never CAOS)"
  - "Servers that support dynamic registration still work as before (existing tests pass)"
touches:
  - "8a7b15d7-faed-4ac0-a39d-498033396dc9"
priority: "high"
source: "ndx-capture"
---
