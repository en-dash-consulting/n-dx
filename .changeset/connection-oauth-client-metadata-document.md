---
"@n-dx/web": patch
---

OAuth connections sign in with n-dx's client ID metadata document (https://docs.n-dx.dev/oauth/client.json) where the authorization server supports it, so servers without dynamic client registration (CAOS) work; registration stays the fallback. Every sign-in returns to the fixed loopback callback `/oauth/callback`, which the hub relays to the project its state names; the `iss` response parameter is checked. A connection's `oauth.clientMetadataUrl` or `oauth.clientId` overrides the client, and a server profile's `oauth` block chooses the scopes asked for (CAOS: read scopes, plus write scopes while a write tool or tracker sync rule is on).
