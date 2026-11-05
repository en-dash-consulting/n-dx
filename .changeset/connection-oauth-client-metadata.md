---
"@n-dx/web": patch
---

A connection's OAuth sign-in works with authorization servers that offer client ID metadata documents instead of dynamic client registration (CAOS): n-dx identifies itself as https://docs.n-dx.dev/oauth/client.json (published by this change) and returns to a fixed loopback `/oauth/callback`, which the hub relays to the right project without reading any credential. A connection can override the client with `oauth.clientMetadataUrl` or a pre-registered `oauth.clientId`. A server profile can name OAuth scopes; the CAOS profile asks only for read scopes unless a write tool or a sync rule needs more.
